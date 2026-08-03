// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./SmartAccount.sol";
import "@openzeppelin/contracts/utils/Create2.sol";

/**
 * @title SmartAccountFactory
 * @notice Counterfactual CREATE2 factory for deterministic SmartAccount deployment.
 */
contract SmartAccountFactory {
    address public immutable entryPoint;
    address public immutable webAuthnVerifier;

    event AccountCreated(address indexed account, uint256 pubX, uint256 pubY, uint256 salt);

    constructor(address _entryPoint, address _verifier) {
        entryPoint = _entryPoint;
        webAuthnVerifier = _verifier;
    }

    /**
     * @notice Deploys SmartAccount using CREATE2.
     */
    function createAccount(
        uint256 pubX,
        uint256 pubY,
        address ecdsaOwner,
        uint256 salt
    ) external returns (SmartAccount account) {
        address addr = getAccountAddress(pubX, pubY, ecdsaOwner, salt);
        if (addr.code.length > 0) {
            return SmartAccount(payable(addr));
        }

        bytes memory bytecode = abi.encodePacked(
            type(SmartAccount).creationCode,
            abi.encode(entryPoint, webAuthnVerifier, pubX, pubY, ecdsaOwner)
        );

        bytes32 saltBytes = bytes32(salt);
        address deployedAddress;
        assembly {
            deployedAddress := create2(0, add(bytecode, 0x20), mload(bytecode), saltBytes)
        }
        require(deployedAddress != address(0), "Factory: CREATE2_FAILED");
        account = SmartAccount(payable(deployedAddress));
        emit AccountCreated(address(account), pubX, pubY, salt);
    }

    /**
     * @notice Computes counterfactual address for SmartAccount before deployment.
     */
    function getAccountAddress(
        uint256 pubX,
        uint256 pubY,
        address ecdsaOwner,
        uint256 salt
    ) public view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(SmartAccount).creationCode,
            abi.encode(entryPoint, webAuthnVerifier, pubX, pubY, ecdsaOwner)
        );

        return Create2.computeAddress(bytes32(salt), keccak256(bytecode));
    }
}
