import React from 'react';

interface WindowProps {
  title: string;
  children: React.ReactNode;
}

const MoneyTrackerWindowContainer: React.FC<WindowProps> = ({ title, children }) => (
  <div style={{ border: '1px solid #ccc', borderRadius: 8, boxShadow: '0 2px 8px #eee', margin: 16 }}>
    <div style={{ background: '#f5f5f5', padding: '12px 16px', borderBottom: '1px solid #ddd', fontWeight: 600, fontSize: 18, color: '#1f2937' }}>
      {title}
    </div>
    <div style={{ padding: 16 }}>
      {children}
    </div>
  </div>
);

export default MoneyTrackerWindowContainer;
