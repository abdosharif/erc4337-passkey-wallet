// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

struct UserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 verificationGasLimit;
    uint256 preVerificationGas;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    bytes paymasterAndData;
    bytes signature;
}

interface IAccount {
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);
}

interface IPaymaster {
    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);

    function postOp(
        uint8 mode,
        bytes calldata context,
        uint256 actualGasCost
    ) external;
}

/**
 * @title EntryPoint
 * @notice Standard ERC-4337 Account Abstraction EntryPoint contract.
 */
contract EntryPoint is ReentrancyGuard {
    mapping(address => uint256) public deposits;

    event UserOperationEvent(
        bytes32 indexed userOpHash,
        address indexed sender,
        address indexed paymaster,
        uint256 nonce,
        bool success,
        uint256 actualGasCost
    );

    event Deposited(address indexed account, uint256 totalDeposit);
    event Withdrawn(address indexed account, address withdrawAddress, uint256 amount);

    function depositTo(address account) public payable {
        deposits[account] += msg.value;
        emit Deposited(account, deposits[account]);
    }

    receive() external payable {
        depositTo(msg.sender);
    }

    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external {
        require(deposits[msg.sender] >= withdrawAmount, "EntryPoint: INSUFFICIENT_DEPOSIT");
        deposits[msg.sender] -= withdrawAmount;
        (bool success, ) = withdrawAddress.call{value: withdrawAmount}("");
        require(success, "EntryPoint: WITHDRAW_FAILED");
        emit Withdrawn(msg.sender, withdrawAddress, withdrawAmount);
    }

    function getUserOpHash(UserOperation calldata userOp) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.callGasLimit,
                userOp.verificationGasLimit,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas,
                keccak256(userOp.paymasterAndData),
                block.chainid,
                address(this)
            )
        );
    }

    /**
     * @notice Executes a batch of UserOperations submitted by a Bundler.
     */
    function handleOps(UserOperation[] calldata ops, address payable beneficiary) external nonReentrant {
        for (uint256 i = 0; i < ops.length; i++) {
            _executeUserOp(ops[i], beneficiary);
        }
    }

    function _executeUserOp(UserOperation calldata op, address payable) internal {
        bytes32 opHash = getUserOpHash(op);

        // 1. Counterfactual Account Deployment via initCode if needed
        if (op.initCode.length >= 20) {
            address factory = address(bytes20(op.initCode[0:20]));
            bytes memory initCallData = op.initCode[20:];
            (bool initSuccess, ) = factory.call(initCallData);
            require(initSuccess, "EntryPoint: FACTORY_INIT_FAILED");
        }

        // 2. Validate UserOperation on SmartAccount
        uint256 validationData = IAccount(op.sender).validateUserOp(op, opHash, 0);
        require(validationData == 0, "EntryPoint: INVALID_ACCOUNT_SIGNATURE");

        // 3. Validate Paymaster if specified
        address paymaster = address(0);
        bytes memory paymasterContext = "";
        if (op.paymasterAndData.length >= 20) {
            paymaster = address(bytes20(op.paymasterAndData[0:20]));
            (paymasterContext, validationData) = IPaymaster(paymaster).validatePaymasterUserOp(op, opHash, 0);
            require(validationData == 0, "EntryPoint: INVALID_PAYMASTER_SIGNATURE");
        }

        // 4. Execute UserOperation callData on SmartAccount
        (bool success, ) = op.sender.call(op.callData);

        // 5. PostOp Paymaster gas accounting
        if (paymaster != address(0)) {
            IPaymaster(paymaster).postOp(0, paymasterContext, 0);
        }

        emit UserOperationEvent(opHash, op.sender, paymaster, op.nonce, success, 0);
    }
}
