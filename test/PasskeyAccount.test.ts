import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SmartAccount, EntryPoint, WebAuthn256r1, VerifyingPaymaster, SmartAccountFactory, ERC20Paymaster } from '../typechain-types';
import { UserOperationStruct } from '../src/bundler/bundler';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('ERC-4337 Passkey Smart Account Advanced Features Suite', function () {
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
  let recipient: SignerWithAddress;
  let sessionKeySigner: SignerWithAddress;

  const PUB_KEY_X = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
  const PUB_KEY_Y = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

  beforeEach(async function () {
    [owner, bundlerSigner, paymasterSigner, guardian1, guardian2, recipient, sessionKeySigner] = await ethers.getSigners();

    const EntryPointFactory = await ethers.getContractFactory('EntryPoint');
    entryPoint = (await EntryPointFactory.deploy()) as EntryPoint;

    const VerifierFactory = await ethers.getContractFactory('WebAuthn256r1');
    verifier = (await VerifierFactory.deploy()) as WebAuthn256r1;

    const PaymasterFactory = await ethers.getContractFactory('VerifyingPaymaster');
    paymaster = (await PaymasterFactory.deploy(
      await entryPoint.getAddress(),
      paymasterSigner.address,
      owner.address
    )) as VerifyingPaymaster;
    await paymaster.deposit({ value: ethers.parseEther('5') });

    const AccountFactory = await ethers.getContractFactory('SmartAccountFactory');
    factory = (await AccountFactory.deploy(await entryPoint.getAddress(), await verifier.getAddress())) as SmartAccountFactory;

    const salt = 12345n;
    await factory.createAccount(PUB_KEY_X, PUB_KEY_Y, owner.address, salt);
    const accountAddr = await factory.getAccountAddress(PUB_KEY_X, PUB_KEY_Y, owner.address, salt);
    smartAccount = (await ethers.getContractAt('SmartAccount', accountAddr)) as SmartAccount;

    await owner.sendTransaction({
      to: await smartAccount.getAddress(),
      value: ethers.parseEther('2'),
    });
  });

  describe('Account Setup & ECDSA Fallback Validation', function () {
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

      const balanceBefore = await ethers.provider.getBalance(recipient.address);
      await entryPoint.connect(bundlerSigner).handleOps([userOp], bundlerSigner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient.address);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther('0.5'));
    });
  });

  describe('Multi-Passkey Device Registry', function () {
    it('should allow adding a secondary hardware Passkey device', async function () {
      const SECONDARY_PUB_X = 0x1111111111111111111111111111111111111111111111111111111111111111n;
      const SECONDARY_PUB_Y = 0x2222222222222222222222222222222222222222222222222222222222222222n;
      const credId = ethers.keccak256(ethers.toUtf8Bytes('secondary_yubikey_01'));

      await expect(smartAccount.connect(owner).addPasskeyDevice(credId, SECONDARY_PUB_X, SECONDARY_PUB_Y))
        .to.emit(smartAccount, 'PasskeyDeviceAdded')
        .withArgs(credId, SECONDARY_PUB_X, SECONDARY_PUB_Y);

      const device = await smartAccount.passkeyDevices(credId);
      expect(device.active).to.be.true;
      expect(device.pubX).to.equal(SECONDARY_PUB_X);
    });
  });

  describe('Ephemeral Session Keys Module', function () {
    it('should register a Session Key and execute UserOperation within valid window', async function () {
      const validUntil = Math.floor(Date.now() / 1000) + 3600;
      const validAfter = 0;
      const spendingLimit = ethers.parseEther('50');

      await smartAccount.connect(owner).registerSessionKey(
        sessionKeySigner.address,
        validUntil,
        validAfter,
        ethers.ZeroAddress,
        '0x00000000',
        spendingLimit
      );

      const sk = await smartAccount.sessionKeys(sessionKeySigner.address);
      expect(sk.active).to.be.true;
      expect(sk.spendingLimit).to.equal(spendingLimit);

      const accountAddr = await smartAccount.getAddress();
      const callData = smartAccount.interface.encodeFunctionData('execute', [recipient.address, ethers.parseEther('0.1'), '0x']);

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
      const sessionKeySig = await sessionKeySigner.signMessage(ethers.getBytes(userOpHash));
      userOp.signature = sessionKeySig;

      const balanceBefore = await ethers.provider.getBalance(recipient.address);
      await entryPoint.connect(bundlerSigner).handleOps([userOp], bundlerSigner.address);
      const balanceAfter = await ethers.provider.getBalance(recipient.address);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther('0.1'));
    });
  });

  describe('Social Guardian Recovery Module', function () {
    it('should register guardians and execute key recovery after threshold and timelock', async function () {
      const guardians = [guardian1.address, guardian2.address];
      const threshold = 2n;

      const addGuardiansData = smartAccount.interface.encodeFunctionData('addGuardians', [guardians, threshold]);
      await smartAccount.connect(owner).execute(await smartAccount.getAddress(), 0, addGuardiansData);

      expect(await smartAccount.isGuardian(guardian1.address)).to.be.true;

      const NEW_PUB_X = 0x1111111111111111111111111111111111111111111111111111111111111111n;
      const NEW_PUB_Y = 0x2222222222222222222222222222222222222222222222222222222222222222n;
      const newOwner = recipient.address;

      await smartAccount.connect(guardian1).proposeKeyRecovery(NEW_PUB_X, NEW_PUB_Y, newOwner);
      await smartAccount.connect(guardian2).approveKeyRecovery();

      await ethers.provider.send('evm_increaseTime', [86401]);
      await ethers.provider.send('evm_mine', []);

      await expect(smartAccount.executeKeyRecovery())
        .to.emit(smartAccount, 'KeyRecovered')
        .withArgs(NEW_PUB_X, NEW_PUB_Y, newOwner);

      expect(await smartAccount.passkeyPubX()).to.equal(NEW_PUB_X);
    });
  });
});
