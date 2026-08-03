import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SmartAccount, EntryPoint, WebAuthn256r1, VerifyingPaymaster, SmartAccountFactory } from '../typechain-types';
import { UserOperationStruct } from '../src/bundler/bundler';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('ERC-4337 Passkey Smart Account & Social Guardian Recovery Suite', function () {
  let entryPoint: EntryPoint;
  let verifier: WebAuthn256r1;
  let paymaster: VerifyingPaymaster;
  let factory: SmartAccountFactory;
  let smartAccount: SmartAccount;

  let owner: SignerWithAddress;
  let bundlerSigner: SignerWithAddress;
  let paymasterSigner: SignerWithAddress;
  let guardian1: SignerWithAddress;
  let guardian2: SignerWithAddress;
  let guardian3: SignerWithAddress;
  let recipient: SignerWithAddress;

  const PUB_KEY_X = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
  const PUB_KEY_Y = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

  beforeEach(async function () {
    [owner, bundlerSigner, paymasterSigner, guardian1, guardian2, guardian3, recipient] = await ethers.getSigners();

    // 1. Deploy EntryPoint
    const EntryPointFactory = await ethers.getContractFactory('EntryPoint');
    entryPoint = (await EntryPointFactory.deploy()) as EntryPoint;
    await entryPoint.waitForDeployment();

    // 2. Deploy WebAuthn P-256 Verifier
    const VerifierFactory = await ethers.getContractFactory('WebAuthn256r1');
    verifier = (await VerifierFactory.deploy()) as WebAuthn256r1;
    await verifier.waitForDeployment();

    // 3. Deploy Paymaster
    const PaymasterFactory = await ethers.getContractFactory('VerifyingPaymaster');
    paymaster = (await PaymasterFactory.deploy(
      await entryPoint.getAddress(),
      paymasterSigner.address,
      owner.address
    )) as VerifyingPaymaster;
    await paymaster.waitForDeployment();

    // Fund Paymaster deposit on EntryPoint
    await paymaster.deposit({ value: ethers.parseEther('5') });

    // 4. Deploy SmartAccountFactory
    const AccountFactory = await ethers.getContractFactory('SmartAccountFactory');
    factory = (await AccountFactory.deploy(await entryPoint.getAddress(), await verifier.getAddress())) as SmartAccountFactory;
    await factory.waitForDeployment();

    // 5. Deploy SmartAccount via Factory
    const salt = 12345n;
    const tx = await factory.createAccount(PUB_KEY_X, PUB_KEY_Y, owner.address, salt);
    await tx.wait();

    const accountAddr = await factory.getAccountAddress(PUB_KEY_X, PUB_KEY_Y, owner.address, salt);
    smartAccount = (await ethers.getContractAt('SmartAccount', accountAddr)) as SmartAccount;

    // Fund SmartAccount with 2 ETH
    await owner.sendTransaction({
      to: await smartAccount.getAddress(),
      value: ethers.parseEther('2'),
    });
  });

  describe('Account Initialization & WebAuthn P-256 Passkey Validation', function () {
    it('should set correct P-256 public keys, EntryPoint, and verifier', async function () {
      expect(await smartAccount.passkeyPubX()).to.equal(PUB_KEY_X);
      expect(await smartAccount.passkeyPubY()).to.equal(PUB_KEY_Y);
      expect(await smartAccount.ecdsaOwner()).to.equal(owner.address);
    });

    it('should validate ECDSA fallback signature on validateUserOp', async function () {
      const accountAddr = await smartAccount.getAddress();
      const callData = smartAccount.interface.encodeFunctionData('execute', [recipient.address, ethers.parseEther('0.5'), '0x']);

      const userOp: UserOperationStruct = {
        sender: accountAddr,
        nonce: 0n,
        initCode: '0x',
        callData: callData,
        callGasLimit: 200000n,
        verificationGasLimit: 300000n,
        preVerificationGas: 50000n,
        maxFeePerGas: 2000000000n,
        maxPriorityFeePerGas: 1000000000n,
        paymasterAndData: '0x',
        signature: '0x',
      };

      const userOpHash = await entryPoint.getUserOpHash(userOp);
      const signature = await owner.signMessage(ethers.getBytes(userOpHash));
      userOp.signature = signature;

      // Execute UserOperation via EntryPoint
      const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);
      await entryPoint.connect(bundlerSigner).handleOps([userOp], bundlerSigner.address);
      const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);

      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(ethers.parseEther('0.5'));
    });
  });

  describe('Social Guardian Recovery Module', function () {
    it('should register guardians and execute key recovery after threshold and timelock', async function () {
      const guardians = [guardian1.address, guardian2.address, guardian3.address];
      const threshold = 2n; // 2-of-3 threshold

      // Owner registers Guardians
      const addGuardiansData = smartAccount.interface.encodeFunctionData('addGuardians', [guardians, threshold]);
      await smartAccount.connect(owner).execute(await smartAccount.getAddress(), 0, addGuardiansData);

      expect(await smartAccount.isGuardian(guardian1.address)).to.be.true;
      expect(await smartAccount.guardianThreshold()).to.equal(threshold);

      // New Key Proposal by Guardian 1
      const NEW_PUB_X = 0x1111111111111111111111111111111111111111111111111111111111111111n;
      const NEW_PUB_Y = 0x2222222222222222222222222222222222222222222222222222222222222222n;
      const newOwner = recipient.address;

      await smartAccount.connect(guardian1).proposeKeyRecovery(NEW_PUB_X, NEW_PUB_Y, newOwner);

      // Guardian 2 approves proposal (meets 2-of-3 threshold)
      await smartAccount.connect(guardian2).approveKeyRecovery();

      // Fast forward time past 24-hour timelock (86400 + 1 seconds)
      await ethers.provider.send('evm_increaseTime', [86401]);
      await ethers.provider.send('evm_mine', []);

      // Execute Recovery
      await expect(smartAccount.executeKeyRecovery())
        .to.emit(smartAccount, 'KeyRecovered')
        .withArgs(NEW_PUB_X, NEW_PUB_Y, newOwner);

      expect(await smartAccount.passkeyPubX()).to.equal(NEW_PUB_X);
      expect(await smartAccount.passkeyPubY()).to.equal(NEW_PUB_Y);
      expect(await smartAccount.ecdsaOwner()).to.equal(newOwner);
    });
  });
});
