// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./EntryPoint.sol";
import "./WebAuthn256r1.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title SmartAccount
 * @notice Production-grade ERC-4337 Smart Account supporting hardware WebAuthn Passkeys (P-256),
 * atomic batch executions, and Social Guardian Recovery with timelocks.
 */
contract SmartAccount is IAccount, ReentrancyGuard {
    using ECDSA for bytes32;

    EntryPoint public immutable entryPoint;
    WebAuthn256r1 public immutable webAuthnVerifier;

    // WebAuthn Passkey Credentials (NIST P-256 Public Key)
    uint256 public passkeyPubX;
    uint256 public passkeyPubY;
    address public ecdsaOwner;

    // Social Guardian Recovery Module
    mapping(address => bool) public isGuardian;
    address[] public guardianList;
    uint256 public guardianThreshold;
    uint256 public constant RECOVERY_TIMELOCK = 1 days;

    struct RecoveryProposal {
        uint256 newPubX;
        uint256 newPubY;
        address newOwner;
        uint256 approvalCount;
        uint256 proposedAt;
        bool executed;
    }

    RecoveryProposal public activeRecovery;
    mapping(address => bool) public recoveryApprovals;

    event KeyRecovered(uint256 newPubX, uint256 newPubY, address newOwner);
    event GuardianAdded(address indexed guardian);
    event RecoveryProposed(address indexed proposer, uint256 newPubX, uint256 newPubY, address newOwner);
    event RecoveryApproved(address indexed guardian);

    modifier onlyEntryPointOrSelf() {
        require(
            msg.sender == address(entryPoint) ||
            msg.sender == address(this) ||
            msg.sender == ecdsaOwner,
            "SmartAccount: NOT_AUTHORIZED"
        );
        _;
    }

    constructor(
        address _entryPoint,
        address _verifier,
        uint256 _pubX,
        uint256 _pubY,
        address _ecdsaOwner
    ) {
        entryPoint = EntryPoint(payable(_entryPoint));
        webAuthnVerifier = WebAuthn256r1(_verifier);
        passkeyPubX = _pubX;
        passkeyPubY = _pubY;
        ecdsaOwner = _ecdsaOwner;
    }

    receive() external payable {}

    /**
     * @notice ERC-4337 UserOperation validation callback.
     */
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external override returns (uint256 validationData) {
        require(msg.sender == address(entryPoint), "SmartAccount: ONLY_ENTRY_POINT");

        if (missingAccountFunds > 0) {
            (bool success, ) = payable(address(entryPoint)).call{value: missingAccountFunds}("");
            success;
        }

        // Validate signature
        bool isValid = _validateSignature(userOpHash, userOp.signature);
        if (!isValid) {
            return 1; // 1 = Signature Validation Failed
        }

        return 0; // 0 = Success
    }

    function _validateSignature(bytes32 userOpHash, bytes calldata signature) internal view returns (bool) {
        if (signature.length == 65) {
            // Mode 1: Fallback ECDSA Signature
            bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(userOpHash);
            return ethHash.recover(signature) == ecdsaOwner;
        } else {
            // Mode 2: Hardware WebAuthn P-256 Passkey Signature
            (
                bytes memory authData,
                bytes memory clientDataJSON,
                uint256 r,
                uint256 s
            ) = abi.decode(signature, (bytes, bytes, uint256, uint256));

            return webAuthnVerifier.verifySignature(
                userOpHash,
                authData,
                clientDataJSON,
                r,
                s,
                passkeyPubX,
                passkeyPubY
            );
        }
    }

    /**
     * @notice Executes a single transaction.
     */
    function execute(address dest, uint256 value, bytes calldata func) external onlyEntryPointOrSelf nonReentrant {
        (bool success, bytes memory result) = dest.call{value: value}(func);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    /**
     * @notice Executes an atomic batch of transactions.
     */
    function executeBatch(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external onlyEntryPointOrSelf nonReentrant {
        require(dest.length == value.length && value.length == func.length, "SmartAccount: LENGTH_MISMATCH");
        for (uint256 i = 0; i < dest.length; i++) {
            (bool success, bytes memory result) = dest[i].call{value: value[i]}(func[i]);
            if (!success) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
        }
    }

    // =========================================================================
    // Social Guardian Recovery Module
    // =========================================================================

    function addGuardians(address[] memory guardians, uint256 threshold) external onlyEntryPointOrSelf {
        require(threshold > 0 && threshold <= guardians.length, "SmartAccount: INVALID_THRESHOLD");
        for (uint256 i = 0; i < guardians.length; i++) {
            require(guardians[i] != address(0) && !isGuardian[guardians[i]], "SmartAccount: INVALID_GUARDIAN");
            isGuardian[guardians[i]] = true;
            guardianList.push(guardians[i]);
            emit GuardianAdded(guardians[i]);
        }
        guardianThreshold = threshold;
    }

    function proposeKeyRecovery(uint256 newPubX, uint256 newPubY, address newOwner) external {
        require(isGuardian[msg.sender], "SmartAccount: ONLY_GUARDIAN");

        activeRecovery = RecoveryProposal({
            newPubX: newPubX,
            newPubY: newPubY,
            newOwner: newOwner,
            approvalCount: 1,
            proposedAt: block.timestamp,
            executed: false
        });

        recoveryApprovals[msg.sender] = true;
        emit RecoveryProposed(msg.sender, newPubX, newPubY, newOwner);
    }

    function approveKeyRecovery() external {
        require(isGuardian[msg.sender], "SmartAccount: ONLY_GUARDIAN");
        require(!activeRecovery.executed && activeRecovery.proposedAt > 0, "SmartAccount: NO_ACTIVE_PROPOSAL");
        require(!recoveryApprovals[msg.sender], "SmartAccount: ALREADY_APPROVED");

        recoveryApprovals[msg.sender] = true;
        activeRecovery.approvalCount++;
        emit RecoveryApproved(msg.sender);
    }

    function executeKeyRecovery() external {
        require(!activeRecovery.executed && activeRecovery.proposedAt > 0, "SmartAccount: NO_ACTIVE_PROPOSAL");
        require(activeRecovery.approvalCount >= guardianThreshold, "SmartAccount: INSUFFICIENT_GUARDIAN_APPROVALS");
        require(block.timestamp >= activeRecovery.proposedAt + RECOVERY_TIMELOCK, "SmartAccount: TIMELOCK_NOT_EXPIRED");

        passkeyPubX = activeRecovery.newPubX;
        passkeyPubY = activeRecovery.newPubY;
        ecdsaOwner = activeRecovery.newOwner;
        activeRecovery.executed = true;

        emit KeyRecovered(activeRecovery.newPubX, activeRecovery.newPubY, activeRecovery.newOwner);
    }

    /**
     * @notice Allows SmartAccount owner to void an unauthorized recovery proposal during timelock.
     */
    function cancelKeyRecovery() external onlyEntryPointOrSelf {
        require(activeRecovery.proposedAt > 0 && !activeRecovery.executed, "SmartAccount: NO_ACTIVE_PROPOSAL");
        delete activeRecovery;
    }
}
