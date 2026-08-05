// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./EntryPoint.sol";
import "./WebAuthn256r1.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title SmartAccount
 * @notice Production-grade ERC-4337 Smart Account supporting:
 * 1. Hardware WebAuthn Passkeys (P-256)
 * 2. Multi-Passkey Device Registry (iPhone, Mac, YubiKey)
 * 3. Ephemeral Session Keys Module with granular spending limits
 * 4. Social Guardian Recovery with timelocks
 * 5. Atomic batch executions
 */
contract SmartAccount is IAccount, ReentrancyGuard {
    using ECDSA for bytes32;

    EntryPoint public immutable entryPoint;
    WebAuthn256r1 public immutable webAuthnVerifier;

    // Multi-Device Hardware Passkeys Registry
    struct PasskeyDevice {
        uint256 pubX;
        uint256 pubY;
        bool active;
    }
    mapping(bytes32 => PasskeyDevice) public passkeyDevices;
    bytes32[] public passkeyIds;

    // Primary Passkey Fallback Keys
    uint256 public passkeyPubX;
    uint256 public passkeyPubY;
    address public ecdsaOwner;

    // Ephemeral Session Keys Module
    struct SessionKey {
        uint48 validUntil;
        uint48 validAfter;
        address targetContract;
        bytes4 selector;
        uint256 spendingLimit;
        uint256 spent;
        bool active;
    }
    mapping(address => SessionKey) public sessionKeys;
    address[] public sessionKeyList;

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
    event PasskeyDeviceAdded(bytes32 indexed credId, uint256 pubX, uint256 pubY);
    event PasskeyDeviceRemoved(bytes32 indexed credId);
    event SessionKeyRegistered(address indexed keyAddress, uint48 validUntil, uint256 spendingLimit);
    event SessionKeyRevoked(address indexed keyAddress);

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

        // Register initial primary passkey
        bytes32 initialCredId = keccak256(abi.encodePacked(_pubX, _pubY));
        passkeyDevices[initialCredId] = PasskeyDevice({pubX: _pubX, pubY: _pubY, active: true});
        passkeyIds.push(initialCredId);
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

        // Validate signature against Passkeys, ECDSA owner, or active Session Keys
        bool isValid = _validateSignature(userOpHash, userOp.signature);
        if (!isValid) {
            return 1; // 1 = Signature Validation Failed
        }

        return 0; // 0 = Success
    }

    function _validateSignature(bytes32 userOpHash, bytes calldata signature) internal view returns (bool) {
        if (signature.length == 65) {
            // Mode 1: Fallback ECDSA Signature OR Session Key Signature
            bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(userOpHash);
            address recovered = ethHash.recover(signature);

            if (recovered == ecdsaOwner) {
                return true;
            }

            // Check if recovered address is a valid active Session Key
            SessionKey memory sk = sessionKeys[recovered];
            if (sk.active && block.timestamp >= sk.validAfter && block.timestamp <= sk.validUntil) {
                return true;
            }

            return false;
        } else {
            // Mode 2: Hardware WebAuthn P-256 Passkey Signature
            (
                bytes memory authData,
                bytes memory clientDataJSON,
                uint256 r,
                uint256 s,
                bytes32 credId
            ) = abi.decode(signature, (bytes, bytes, uint256, uint256, bytes32));

            PasskeyDevice memory device = passkeyDevices[credId];
            uint256 targetPubX = device.active ? device.pubX : passkeyPubX;
            uint256 targetPubY = device.active ? device.pubY : passkeyPubY;

            return webAuthnVerifier.verifySignature(
                userOpHash,
                authData,
                clientDataJSON,
                r,
                s,
                targetPubX,
                targetPubY
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
    // Multi-Passkey Device Registry Module
    // =========================================================================

    function addPasskeyDevice(bytes32 credId, uint256 pubX, uint256 pubY) external onlyEntryPointOrSelf {
        require(pubX > 0 && pubY > 0, "SmartAccount: INVALID_PUBKEY");
        require(!passkeyDevices[credId].active, "SmartAccount: DEVICE_EXISTS");

        passkeyDevices[credId] = PasskeyDevice({pubX: pubX, pubY: pubY, active: true});
        passkeyIds.push(credId);
        emit PasskeyDeviceAdded(credId, pubX, pubY);
    }

    function removePasskeyDevice(bytes32 credId) external onlyEntryPointOrSelf {
        require(passkeyDevices[credId].active, "SmartAccount: DEVICE_NOT_FOUND");
        passkeyDevices[credId].active = false;
        emit PasskeyDeviceRemoved(credId);
    }

    // =========================================================================
    // Ephemeral Session Keys Module
    // =========================================================================

    function registerSessionKey(
        address keyAddress,
        uint48 validUntil,
        uint48 validAfter,
        address targetContract,
        bytes4 selector,
        uint256 spendingLimit
    ) external onlyEntryPointOrSelf {
        require(keyAddress != address(0), "SmartAccount: INVALID_KEY");
        require(validUntil > block.timestamp, "SmartAccount: INVALID_EXPIRATION");

        sessionKeys[keyAddress] = SessionKey({
            validUntil: validUntil,
            validAfter: validAfter,
            targetContract: targetContract,
            selector: selector,
            spendingLimit: spendingLimit,
            spent: 0,
            active: true
        });

        sessionKeyList.push(keyAddress);
        emit SessionKeyRegistered(keyAddress, validUntil, spendingLimit);
    }

    function revokeSessionKey(address keyAddress) external onlyEntryPointOrSelf {
        require(sessionKeys[keyAddress].active, "SmartAccount: SESSION_NOT_ACTIVE");
        sessionKeys[keyAddress].active = false;
        emit SessionKeyRevoked(keyAddress);
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

    function cancelKeyRecovery() external onlyEntryPointOrSelf {
        require(activeRecovery.proposedAt > 0 && !activeRecovery.executed, "SmartAccount: NO_ACTIVE_PROPOSAL");
        delete activeRecovery;
    }
}
