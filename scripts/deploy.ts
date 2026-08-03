import { ethers } from 'hardhat';

async function main() {
  const [deployer, paymasterSigner] = await ethers.getSigners();

  console.log(`====================================================`);
  console.log(`🚀 Deploying ERC-4337 Account Abstraction Infrastructure`);
  console.log(`====================================================`);

  // 1. Deploy EntryPoint
  const EntryPointFactory = await ethers.getContractFactory('EntryPoint');
  const entryPoint = await EntryPointFactory.deploy();
  await entryPoint.waitForDeployment();
  const entryPointAddress = await entryPoint.getAddress();

  // 2. Deploy WebAuthn P-256 Verifier
  const VerifierFactory = await ethers.getContractFactory('WebAuthn256r1');
  const verifier = await VerifierFactory.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();

  // 3. Deploy VerifyingPaymaster
  const PaymasterFactory = await ethers.getContractFactory('VerifyingPaymaster');
  const paymaster = await PaymasterFactory.deploy(entryPointAddress, paymasterSigner.address, deployer.address);
  await paymaster.waitForDeployment();
  const paymasterAddress = await paymaster.getAddress();

  // Fund Paymaster deposit on EntryPoint with 5 ETH
  await paymaster.deposit({ value: ethers.parseEther('5') });

  // 4. Deploy SmartAccountFactory
  const AccountFactory = await ethers.getContractFactory('SmartAccountFactory');
  const factory = await AccountFactory.deploy(entryPointAddress, verifierAddress);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  console.log(`✅ EntryPoint Contract:        ${entryPointAddress}`);
  console.log(`✅ WebAuthn P-256 Verifier:    ${verifierAddress}`);
  console.log(`⛽ VerifyingPaymaster:         ${paymasterAddress}`);
  console.log(`🏭 SmartAccountFactory:        ${factoryAddress}`);
  console.log(`🔑 Paymaster Off-Chain Signer: ${paymasterSigner.address}`);
  console.log(`====================================================`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
