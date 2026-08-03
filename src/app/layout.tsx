import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Apex Passkey Smart Wallet | ERC-4337 Account Abstraction',
  description: 'Next-Gen ERC-4337 Smart Account with Face ID / Touch ID hardware authentication, Paymaster gas sponsorship, and Social Guardian Recovery.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header style={{ borderBottom: '1px solid var(--border-card)', padding: '16px 32px', background: 'rgba(10, 12, 20, 0.8)', backdropFilter: 'blur(10px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '22px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>🔑</span> Apex Passkey Smart Wallet
          </div>
          <span style={{ fontSize: '13px', background: 'rgba(139, 92, 246, 0.2)', color: '#a78bfa', padding: '6px 12px', borderRadius: '20px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
            ERC-4337 + WebAuthn P-256
          </span>
        </header>
        <main style={{ maxWidth: '1000px', margin: '0 auto', padding: '40px 20px' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
