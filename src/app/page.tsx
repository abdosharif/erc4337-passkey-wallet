'use client';

import { useState } from 'react';

export default function PasskeyWalletDashboard() {
  const [accountAddress, setAccountAddress] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isGaslessExecuting, setIsGaslessExecuting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleRegisterPasskey = async () => {
    setIsRegistering(true);
    setTimeout(() => {
      setAccountAddress('0x71C7656EC7ab88b098defB751B7401B5f6d8976F');
      setIsRegistering(false);
    }, 1200);
  };

  const handleExecuteGaslessTx = async () => {
    setIsGaslessExecuting(true);
    setTimeout(() => {
      setTxHash('0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b');
      setIsGaslessExecuting(false);
    }, 1500);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Hero Welcome Banner */}
      <div className="glass-panel" style={{ padding: '48px 32px', textAlign: 'center', background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(16, 185, 129, 0.08) 100%)' }}>
        <h1 style={{ fontSize: '36px', marginBottom: '12px' }}>Smart Wallet Powered by Face ID / Touch ID</h1>
        <p style={{ color: 'var(--text-muted)', maxWidth: '650px', margin: '0 auto 28px' }}>
          No Seed Phrases. No Browser Extensions. Seamless WebAuthn P-256 hardware authentication & Paymaster gasless transactions.
        </p>

        {!accountAddress ? (
          <button className="btn-passkey" onClick={handleRegisterPasskey} disabled={isRegistering}>
            <span>{isRegistering ? '⚡ Authenticating Hardware Biometrics...' : '👆 Register Passkey (Touch ID / Face ID)'}</span>
          </button>
        ) : (
          <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: '#10b981', fontWeight: 'bold' }}>✓ Smart Account Counterfactual Address Deployed</span>
            <span className="mono" style={{ fontSize: '18px', background: 'rgba(0,0,0,0.4)', padding: '10px 20px', borderRadius: '10px', border: '1px solid var(--border-card)' }}>
              {accountAddress}
            </span>
          </div>
        )}
      </div>

      {/* Dashboard Features Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        {/* Card 1: Gasless Paymaster */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>⛽ Paymaster Gas Sponsorship</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px' }}>
            Execute transactions without holding ETH. Paymaster sponsors gas fees or accepts payments in custom tokens.
          </p>
          <button className="btn-secondary" onClick={handleExecuteGaslessTx} disabled={!accountAddress || isGaslessExecuting}>
            {isGaslessExecuting ? 'Signing with Passkey...' : '🚀 Test Gasless UserOperation'}
          </button>
          {txHash && (
            <div style={{ marginTop: '16px', fontSize: '12px', color: '#10b981' }}>
              UserOperation Executed! Hash: <span className="mono">{txHash.substring(0, 16)}...</span>
            </div>
          )}
        </div>

        {/* Card 2: Social Guardian Recovery */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>🛡️ Social Guardian Recovery</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px' }}>
            Lost your phone or Passkey? 2-of-3 registered Guardians can vote to recover your Smart Account key.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <span className="mono" style={{ fontSize: '12px', background: 'rgba(255,255,255,0.05)', padding: '6px 12px', borderRadius: '6px' }}>2 of 3 Threshold</span>
            <span className="mono" style={{ fontSize: '12px', background: 'rgba(255,255,255,0.05)', padding: '6px 12px', borderRadius: '6px' }}>24h Timelock</span>
          </div>
        </div>
      </div>
    </div>
  );
}
