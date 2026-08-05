// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./EntryPoint.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ERC20Paymaster
 * @notice Paymaster allowing users to pay gas fees in custom ERC-20 tokens (USDC/USDT) instead of native ETH.
 */
contract ERC20Paymaster is IPaymaster, Ownable {
    EntryPoint public immutable entryPoint;
    IERC20 public immutable token;
    uint256 public tokenPriceRate; // Rate: 1 ETH = tokenPriceRate ERC-20 tokens

    constructor(address _entryPoint, address _token, uint256 _tokenPriceRate, address initialOwner) Ownable(initialOwner) {
        entryPoint = EntryPoint(payable(_entryPoint));
        token = IERC20(_token);
        tokenPriceRate = _tokenPriceRate; // e.g. 3000 * 1e6 for USDC (3000 USDC per 1 ETH)
    }

    function setTokenPriceRate(uint256 _tokenPriceRate) external onlyOwner {
        tokenPriceRate = _tokenPriceRate;
    }

    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external override returns (bytes memory context, uint256 validationData) {
        require(msg.sender == address(entryPoint), "ERC20Paymaster: ONLY_ENTRY_POINT");

        // Calculate token gas cost: maxCost (in wei) * tokenPriceRate / 1e18
        uint256 tokenAmount = (maxCost * tokenPriceRate) / 1e18;

        // Collect ERC-20 gas fee from Smart Account
        if (tokenAmount > 0) {
            bool success = token.transferFrom(userOp.sender, address(this), tokenAmount);
            require(success, "ERC20Paymaster: TOKEN_TRANSFER_FAILED");
        }

        return (abi.encode(userOp.sender, tokenAmount), 0);
    }

    function postOp(
        uint8 mode,
        bytes calldata context,
        uint256 actualGasCost
    ) external override {
        require(msg.sender == address(entryPoint), "ERC20Paymaster: ONLY_ENTRY_POINT");
    }
}
