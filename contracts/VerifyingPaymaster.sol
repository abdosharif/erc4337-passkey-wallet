// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./EntryPoint.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title VerifyingPaymaster
 * @notice Verifying Paymaster enabling gasless transactions sponsored by dApps or off-chain paymaster signers.
 */
contract VerifyingPaymaster is IPaymaster, Ownable {
    using ECDSA for bytes32;

    EntryPoint public immutable entryPoint;
    address public verifyingSigner;

    constructor(address _entryPoint, address _verifyingSigner, address initialOwner) Ownable(initialOwner) {
        entryPoint = EntryPoint(payable(_entryPoint));
        verifyingSigner = _verifyingSigner;
    }

    function setVerifyingSigner(address _verifyingSigner) external onlyOwner {
        verifyingSigner = _verifyingSigner;
    }

    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external override returns (bytes memory context, uint256 validationData) {
        require(msg.sender == address(entryPoint), "Paymaster: ONLY_ENTRY_POINT");
        require(userOp.paymasterAndData.length >= 85, "Paymaster: INVALID_PAYMASTER_DATA");

        // Extract validUntil, validAfter, and paymaster signature from paymasterAndData
        uint48 validUntil = uint48(bytes6(userOp.paymasterAndData[20:26]));
        uint48 validAfter = uint48(bytes6(userOp.paymasterAndData[26:32]));
        bytes calldata signature = userOp.paymasterAndData[32:97];

        bytes32 hash = keccak256(
            abi.encodePacked(
                userOp.sender,
                userOp.nonce,
                userOpHash,
                validUntil,
                validAfter,
                block.chainid,
                address(this)
            )
        );

        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(hash);
        address recovered = ethSignedHash.recover(signature);

        if (recovered != verifyingSigner) {
            return ("", 1); // 1 = Signature Verification Failed
        }

        return (abi.encode(userOp.sender), 0); // 0 = Success
    }

    function postOp(
        uint8 mode,
        bytes calldata context,
        uint256 actualGasCost
    ) external override {
        require(msg.sender == address(entryPoint), "Paymaster: ONLY_ENTRY_POINT");
    }
}
