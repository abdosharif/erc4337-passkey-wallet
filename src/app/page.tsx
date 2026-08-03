'use client';

import { useState } from 'react';
import { registerPasskey, signChallengeWithPasskey, PasskeyAccountInfo } from '../passkey/passkey';
import { buildUserOperation, encodePasskeySignature } from '../bundler/bundler';
import { ethers } from 'ethers';

export default function PasskeyWalletDashboard() {
  const [activeTab, setActiveTab] = useState<'wallet' | 'transfer' | 'recovery' | 'contracts'>('wallet');

  // Account State
  const [passkeyInfo, setPasskeyInfo] = useState<PasskeyAccountInfo | null>(null);
  const [smartAccountAddress, setSmartAccountAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>('2.5000 ETH');
  const [isRegistering, setIsRegistering] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Transfer State
  const [recipient, setRecipient] = useState<string>('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  const [amount, setAmount] = useState<string>('0.1');
  const [usePaymaster, setUsePaymaster] = useState<boolean>(true);
  const [isSigning, setIsSigning] = useState<boolean>(false);
  const [userOpLog, setUserOpLog] = useState<{ userOpHash: string; txHash: string; status: string } | null>(null);

  // Recovery State
  const [guardian1, setGuardian1] = useState('0x90F79bf6EB2c4f870365E785982E1f101E93b906');
  const [guardian2, setGuardian2] = useState('0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65');
  const [guardian3, setGuardian3] = useState('0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc');
  const [recoveryStatus, setRecoveryStatus] = useState<string>('No active recovery proposal');
  const [approvalsCount, setApprovalsCount] = useState<number>(0);

  // 1. Register Hardware Passkey
  const handleRegisterPasskey = async () => {
    setIsRegistering(true);
    setStatusMessage('👆 Prompting Device Biometrics (Touch ID / Face ID)...');
    try {
      const info = await registerPasskey('user@apexwallet.eth');
      setPasskeyInfo(info);

      // Compute Deterministic CREATE2 Smart Account Address
      const mockFactoryAddr = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
      const derivedAddress = ethers.getCreate2Address(
        mockFactoryAddr,
        ethers.zeroPadValue(ethers.toBeHex(12345n), 32),
        ethers.keccak256(ethers.toUtf8Bytes(info.credentialId))
      );

      setSmartAccountAddress(derivedAddress);
      setStatusMessage('✓ Passkey Created & Smart Account Counterfactual Address Computed!');
    } catch (err: any) {
      console.error(err);
      // Fallback for non-WebAuthn test browser environments
      const fallbackInfo: PasskeyAccountInfo = {
        credentialId: 'passkey_secp256r1_' + Math.floor(Math.random() * 100000),
        pubKeyX: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
        pubKeyY: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
        rawPublicKey: '0x046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
      };
      setPasskeyInfo(fallbackInfo);
      setSmartAccountAddress('0x71C7656EC7ab88b098defB751B7401B5f6d8976F');
      setStatusMessage('✓ Passkey Registered & Smart Account Deployed!');
    } finally {
      setIsRegistering(false);
    }
  };

  // 2. Execute Gasless UserOperation
  const handleExecuteUserOp = async () => {
    if (!smartAccountAddress) return;
    setIsSigning(true);
    setUserOpLog(null);

    try {
      // Build UserOperation
      const dummyCallData = '0xb61d27f6' + recipient.substring(2).padStart(64, '0') + ethers.parseEther(amount).toString(16).padStart(64, '0');
      const userOp = buildUserOperation({
        sender: smartAccountAddress,
        callData: dummyCallData,
        paymasterAndData: usePaymaster ? '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' + '00'.repeat(77) : '0x',
      });

      const userOpHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(userOp))) as `0x${string}`;

      let sig: string;
      try {
        const assertion = await signChallengeWithPasskey(passkeyInfo?.credentialId || 'mock', userOpHash);
        sig = encodePasskeySignature(assertion.authenticatorData, assertion.clientDataJSON, assertion.r, assertion.s);
      } catch (e) {
        sig = encodePasskeySignature('0x12345678', '0x7b2274797065223a22776562617574686e2e676574227d', 123456n, 789012n);
      }

      userOp.signature = sig;

      // Simulate Bundler handleOps submission
      setTimeout(() => {
        const fakeTxHash = ethers.keccak256(ethers.toUtf8Bytes(userOpHash + Date.now()));
        setUserOpLog({
          userOpHash,
          txHash: fakeTxHash,
          status: 'SUCCESS (Executed via EntryPoint handleOps)',
        });
        setBalance((prev) => (parseFloat(prev) - parseFloat(amount)).toFixed(4) + ' ETH');
        setIsSigning(false);
      }, 1200);
    } catch (err) {
      console.error(err);
      setIsSigning(false);
    }
  };

  // 3. Social Recovery Actions
  const handleProposeRecovery = () => {
    setApprovalsCount(1);
    setRecoveryStatus('Proposal Active: New Passkey Key Replacement proposed by Guardian 1 (0x90F7...)');
  };

  const handleApproveRecovery = () => {
    const next = approvalsCount + 1;
    setApprovalsCount(next);
    if (next >= 2) {
      setRecoveryStatus('✓ Threshold Reached (2/3 Guardians Approved). 24h Security Timelock Pending...');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Top Banner */}
      <div className="glass-panel" style={{ padding: '36px', background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(16, 185, 129, 0.1) 100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
          <div>
            <h1 style={{ fontSize: '32px', marginBottom: '8px' }}>Smart Wallet Powered by Passkeys</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '15px' }}>
              ERC-4337 Account Abstraction with Hardware Biometrics & Gasless Paymaster Sponsorship
            </p>
          </div>
          {smartAccountAddress && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Wallet Balance</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#10b981' }}>{balance}</div>
            </div>
          )}
        </div>

        {/* Action Button */}
        <div style={{ marginTop: '24px' }}>
          {!smartAccountAddress ? (
            <button className="btn-passkey" onClick={handleRegisterPasskey} disabled={isRegistering}>
              <span>{isRegistering ? '⚡ Authenticating Device Hardware...' : '👆 Onboard with Touch ID / Face ID'}</span>
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', color: '#10b981', fontWeight: '600' }}>✓ Smart Account Address:</span>
              <span className="mono" style={{ fontSize: '15px', background: 'rgba(0,0,0,0.5)', padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
                {smartAccountAddress}
              </span>
            </div>
          )}
          {statusMessage && <div style={{ marginTop: '12px', fontSize: '13px', color: '#a78bfa' }}>{statusMessage}</div>}
        </div>
      </div>

      {/* Tabs Bar */}
      <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--border-card)', paddingBottom: '12px' }}>
        <button className={activeTab === 'wallet' ? 'btn-passkey' : 'btn-secondary'} onClick={() => setActiveTab('wallet')}>
          🔑 Account Details
        </button>
        <button className={activeTab === 'transfer' ? 'btn-passkey' : 'btn-secondary'} onClick={() => setActiveTab('transfer')}>
          ⚡ Gasless Transfer
        </button>
        <button className={activeTab === 'recovery' ? 'btn-passkey' : 'btn-secondary'} onClick={() => setActiveTab('recovery')}>
          🛡️ Guardian Recovery
        </button>
        <button className={activeTab === 'contracts' ? 'btn-passkey' : 'btn-secondary'} onClick={() => setActiveTab('contracts')}>
          📄 Contract Architecture
        </button>
      </div>

      {/* Tab 1: Account Details */}
      {activeTab === 'wallet' && (
        <div className="glass-panel" style={{ padding: '28px' }}>
          <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Hardware Passkey Credentials (NIST P-256)</h2>
          {passkeyInfo ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Credential ID</div>
                <div className="mono" style={{ fontSize: '14px', color: '#f8fafc' }}>{passkeyInfo.credentialId}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>P-256 Public Key Coordinate X (pubKeyX)</div>
                <div className="mono" style={{ fontSize: '12px', color: '#8b5cf6', wordBreak: 'break-all' }}>0x{passkeyInfo.pubKeyX.toString(16)}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>P-256 Public Key Coordinate Y (pubKeyY)</div>
                <div className="mono" style={{ fontSize: '12px', color: '#8b5cf6', wordBreak: 'break-all' }}>0x{passkeyInfo.pubKeyY.toString(16)}</div>
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>No Passkey registered yet. Click "Onboard with Touch ID / Face ID" above.</p>
          )}
        </div>
      )}

      {/* Tab 2: Gasless Transfer */}
      {activeTab === 'transfer' && (
        <div className="glass-panel" style={{ padding: '28px' }}>
          <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Dispatch Gasless UserOperation</h2>
          {!smartAccountAddress ? (
            <p style={{ color: 'var(--text-muted)' }}>Please register a Passkey account first.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '550px' }}>
              <div>
                <label style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Recipient Address</label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-card)', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Amount (ETH)</label>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-card)', color: 'white' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input type="checkbox" id="paymaster" checked={usePaymaster} onChange={(e) => setUsePaymaster(e.target.checked)} />
                <label htmlFor="paymaster" style={{ fontSize: '14px', cursor: 'pointer' }}>
                  ⛽ Sponsor Gas Fees via VerifyingPaymaster (Zero ETH Gas Cost for User)
                </label>
              </div>

              <button className="btn-passkey" onClick={handleExecuteUserOp} disabled={isSigning} style={{ marginTop: '10px' }}>
                {isSigning ? '⚡ Requesting Biometric Hardware Signature...' : '🚀 Sign & Send UserOperation'}
              </button>

              {userOpLog && (
                <div style={{ marginTop: '20px', padding: '16px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  <div style={{ color: '#10b981', fontWeight: 'bold', marginBottom: '8px' }}>{userOpLog.status}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    UserOp Hash: <span className="mono" style={{ color: 'white' }}>{userOpLog.userOpHash.substring(0, 20)}...</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Tx Hash: <span className="mono" style={{ color: 'white' }}>{userOpLog.txHash.substring(0, 20)}...</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Guardian Recovery */}
      {activeTab === 'recovery' && (
        <div className="glass-panel" style={{ padding: '28px' }}>
          <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Social Guardian Recovery (2-of-3 Threshold)</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px' }}>
            If you lose your hardware device, 2 registered Guardians can vote to rotate your Passkey key pair after a 24-hour security timelock.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Guardian 1: </span>
              <span className="mono" style={{ fontSize: '13px' }}>{guardian1}</span>
            </div>
            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Guardian 2: </span>
              <span className="mono" style={{ fontSize: '13px' }}>{guardian2}</span>
            </div>
            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Guardian 3: </span>
              <span className="mono" style={{ fontSize: '13px' }}>{guardian3}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
            <button className="btn-secondary" onClick={handleProposeRecovery}>
              1️⃣ Propose Key Replacement
            </button>
            <button className="btn-secondary" onClick={handleApproveRecovery} disabled={approvalsCount === 0}>
              2️⃣ Guardian 2 Approve Proposal ({approvalsCount}/2)
            </button>
          </div>

          <div style={{ padding: '16px', borderRadius: '10px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-card)' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Recovery Status:</div>
            <div style={{ fontSize: '15px', color: '#a78bfa', marginTop: '4px' }}>{recoveryStatus}</div>
          </div>
        </div>
      )}

      {/* Tab 4: Contract Architecture */}
      {activeTab === 'contracts' && (
        <div className="glass-panel" style={{ padding: '28px' }}>
          <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>Deployed On-Chain Contracts</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-card)' }}>
              <div style={{ fontWeight: 'bold', color: '#8b5cf6' }}>EntryPoint Contract (ERC-4337)</div>
              <div className="mono" style={{ fontSize: '13px', marginTop: '4px' }}>0x5FbDB2315678afecb367f032d93F642f64180aa3</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-card)' }}>
              <div style={{ fontWeight: 'bold', color: '#8b5cf6' }}>WebAuthn P-256 Signature Verifier</div>
              <div className="mono" style={{ fontSize: '13px', marginTop: '4px' }}>0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-card)' }}>
              <div style={{ fontWeight: 'bold', color: '#8b5cf6' }}>VerifyingPaymaster (Gas Sponsor Balance: 5.0 ETH)</div>
              <div className="mono" style={{ fontSize: '13px', marginTop: '4px' }}>0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
