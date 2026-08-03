import { ethers } from 'ethers';

export interface UserOperationStruct {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: string;
  signature: string;
}

/**
 * Builds a valid ERC-4337 UserOperation struct.
 */
export function buildUserOperation(params: {
  sender: string;
  nonce?: bigint;
  initCode?: string;
  callData: string;
  paymasterAndData?: string;
  signature?: string;
}): UserOperationStruct {
  return {
    sender: params.sender,
    nonce: params.nonce ?? 0n,
    initCode: params.initCode ?? '0x',
    callData: params.callData,
    callGasLimit: 200000n,
    verificationGasLimit: 300000n,
    preVerificationGas: 50000n,
    maxFeePerGas: 2000000000n,
    maxPriorityFeePerGas: 1000000000n,
    paymasterAndData: params.paymasterAndData ?? '0x',
    signature: params.signature ?? '0x',
  };
}

/**
 * Encodes WebAuthn Passkey parameters into Solidity ABI signature byte string.
 */
export function encodePasskeySignature(
  authData: string,
  clientDataJSON: string,
  r: bigint,
  s: bigint
): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(['bytes', 'bytes', 'uint256', 'uint256'], [authData, clientDataJSON, r, s]);
}
