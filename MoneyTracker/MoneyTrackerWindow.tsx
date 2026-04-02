
import React, { useState, useEffect } from 'react';
// Transaction data model
export interface Transaction {
  'Transaction Type': string;
  Payee: string;
  Category: string;
  Total: number;
  MainType: string;
  SubType: string;
}


import MoneyTrackerWindowContainer from './ui/Window';

const MoneyTrackerWindow: React.FC = () => {
  const [mainTypeFilter, setMainTypeFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [breakdownFilter, setBreakdownFilter] = useState<string>('Income');
  const [file, setFile] = useState<File | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // Load transactions from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('moneytracker_transactions');
    if (saved) {
      try {
        setTransactions(JSON.parse(saved));
      } catch {}
    }
  }, []);

  // Save transactions to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('moneytracker_transactions', JSON.stringify(transactions));
  }, [transactions]);

  // Compute filtered transactions
  const filteredTransactions = transactions.filter(t => {
    return (
      (t.MainType === breakdownFilter) &&
      (!categoryFilter || t.Category === categoryFilter)
    );
  });

  // Get unique MainTypes and Categories for dropdowns
  const mainTypes = Array.from(new Set(transactions.map(t => t.MainType))).filter(Boolean);
  const categories = Array.from(new Set(transactions.map(t => t.Category))).filter(Boolean);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0] as File);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Invalid file. Please select a CSV file.');
      return;
    }
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('http://localhost:5001/api/upload-csv', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setTransactions(data.transactions);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <MoneyTrackerWindowContainer title="💰 Money Tracker">
      <div style={{ maxWidth: '100%' }}>
        {/* Upload Section */}
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: 16,
          padding: 24,
          marginBottom: 24,
          color: 'white',
          boxShadow: '0 8px 24px rgba(102, 126, 234, 0.3)'
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: 18 }}>📊 Import Your Bank Data</h3>
          <p style={{ margin: '0 0 16px 0', opacity: 0.9, fontSize: 14 }}>Upload a CSV file from your bank to see your spending patterns</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input 
              type="file" 
              accept=".csv" 
              onChange={handleFileChange}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: 'none',
                fontSize: 14,
                cursor: 'pointer',
                flex: 1,
                minWidth: 150,
                background: 'rgba(255,255,255,0.95)',
                color: '#1f2937',
                fontWeight: 500
              }}
            />
            <button 
              onClick={handleUpload} 
              disabled={!file || loading}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: 'white',
                color: '#667eea',
                fontWeight: 600,
                fontSize: 14,
                cursor: !file || loading ? 'not-allowed' : 'pointer',
                opacity: !file || loading ? 0.6 : 1,
                transition: 'transform 0.2s',
              }}
              onMouseDown={(e) => { if (!loading && file) (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)'; }}
              onMouseUp={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
            >
              {loading ? '⏳ Processing...' : '✨ Upload'}
            </button>
          </div>
          {error && <div style={{ marginTop: 12, padding: 10, background: 'rgba(255,255,255,0.2)', borderRadius: 8, fontSize: 14 }}>❌ {error}</div>}
        </div>

        {transactions.length > 0 && (
          <>
            {/* Summary Cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 16,
              marginBottom: 24
            }}>
              {(() => {
                const sum = (type: string) => transactions.filter(t => t.MainType === type).reduce((acc, t) => acc + (Number(t.Total) || 0), 0);
                const income = sum('Income');
                const expenses = sum('Expense');
                const savings = sum('Savings');
                const investments = sum('Investment');
                const balance = income + savings + investments + expenses;

                const cards = [
                  { icon: '📈', label: 'Income', value: income, color: '#10b981' },
                  { icon: '💸', label: 'Spent', value: expenses, color: '#ef4444' },
                  { icon: '🏦', label: 'Saved', value: savings, color: '#3b82f6' },
                  { icon: '📊', label: 'Invested', value: investments, color: '#f59e0b' },
                  { icon: '💎', label: 'Balance', value: balance, color: balance >= 0 ? '#10b981' : '#ef4444' }
                ];

                return cards.map(card => (
                  <div
                    key={card.label}
                    style={{
                      background: 'white',
                      border: `2px solid ${card.color}20`,
                      borderRadius: 12,
                      padding: 16,
                      textAlign: 'center',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{card.icon}</div>
                    <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{card.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: card.color }}>
                      {card.value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Visualization - Simple charts */}
            <div style={{ display: 'flex', gap: 24, margin: '24px 0', flexWrap: 'wrap' }}>
              {/* Bar Chart: Money Flow by Category */}
              <div style={{ flex: 1, minWidth: 320, background: 'white', borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#333' }}>📊 Money Flow by Category</h4>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, height: 220 }}>
                  {(() => {
                    const sum = (type: string) => Math.abs(transactions.filter(t => t.MainType === type).reduce((acc, t) => acc + (Number(t.Total) || 0), 0));
                    const categories = [
                      { label: 'Income', value: sum('Income'), color: '#10b981', emoji: '📈' },
                      { label: 'Expenses', value: sum('Expense'), color: '#ef4444', emoji: '💸' },
                      { label: 'Savings', value: sum('Savings'), color: '#3b82f6', emoji: '🏦' },
                      { label: 'Invested', value: sum('Investment'), color: '#f59e0b', emoji: '📊' }
                    ];
                    const maxVal = Math.max(...categories.map(c => c.value));
                    return categories.map((cat, idx) => {
                      const height = maxVal > 0 ? (cat.value / maxVal) * 160 : 0;
                      return (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 8 }}>
                          <div
                            style={{
                              width: '100%',
                              height: height,
                              background: cat.color,
                              borderRadius: 6,
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              opacity: 0.8,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.transform = 'scaleY(1.05)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; (e.currentTarget as HTMLElement).style.transform = 'scaleY(1)'; }}
                            title={`${cat.emoji} ${cat.label}: ${cat.value.toLocaleString()}`}
                          />
                          <div style={{ fontSize: 13, fontWeight: 600, color: cat.color }}>
                            {cat.value.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                          </div>
                          <div style={{ fontSize: 11, color: '#666', textAlign: 'center' }}>
                            <div>{cat.emoji}</div>
                            <div>{cat.label}</div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Pie Chart: Category Breakdown */}
              <div style={{ flex: 1, minWidth: 320, background: 'white', borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, color: '#333' }}>🥧 Breakdown</h4>
                  <select
                    value={breakdownFilter}
                    onChange={(e) => setBreakdownFilter(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: '2px solid #667eea',
                      fontSize: 12,
                      cursor: 'pointer',
                      background: 'white',
                      color: '#1f2937',
                      fontWeight: 500
                    }}
                  >
                    <option value="Income">📈 Income</option>
                    <option value="Expense">💸 Expenses</option>
                    <option value="Savings">🏦 Savings</option>
                    <option value="Investment">📊 Investments</option>
                  </select>
                </div>
                {(() => {
                  const filteredData = transactions.filter(t => t.MainType === breakdownFilter);
                  const categoryData = Object.entries(
                    filteredData.reduce((acc, t) => {
                      const key = t.Category || t.Payee;
                      acc[key] = (acc[key] || 0) + Math.abs(Number(t.Total));
                      return acc;
                    }, {} as Record<string, number>)
                  ).sort((a, b) => b[1] - a[1]);

                  return (
                    <div>
                      {/* Debug info */}
                      <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
                        {filteredData.length} transactions • {categoryData.length} categories
                      </div>

                      {categoryData.length > 0 ? (
                        <div style={{ display: 'flex', gap: 16 }}>
                          {/* SVG Pie Chart */}
                          <svg width={160} height={160} style={{ flexShrink: 0 }}>
                            {(() => {
                              const top8 = categoryData.slice(0, 8);
                              const others = categoryData.slice(8);
                              const otherTotal = others.reduce((sum, [, val]) => sum + val, 0);
                              
                              // Build data with "Other" slice if needed
                              const data = otherTotal > 0 ? [...top8, ['Other', otherTotal]] : top8;
                              const total = data.reduce((sum, [, val]) => sum + val, 0);
                              const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe', '#43e97b', '#fa709a', '#fee140', '#c8b6ff'];
                              
                              // If only one category (100%), draw a full circle
                              if (data.length === 1) {
                                return (
                                  <circle cx={80} cy={80} r={60} fill={colors[0]} stroke="white" strokeWidth={2} />
                                );
                              }

                              let angle = -90;
                              return data.map(([name, value], idx) => {
                                const sliceAngle = (value / total) * 360;
                                const startAngle = angle * (Math.PI / 180);
                                const endAngle = (angle + sliceAngle) * (Math.PI / 180);
                                const radius = 60;
                                const x1 = 80 + radius * Math.cos(startAngle);
                                const y1 = 80 + radius * Math.sin(startAngle);
                                const x2 = 80 + radius * Math.cos(endAngle);
                                const y2 = 80 + radius * Math.sin(endAngle);
                                const largeArc = sliceAngle > 180 ? 1 : 0;
                                const path = `M 80 80 L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
                                angle += sliceAngle;

                                return <path key={idx} d={path} fill={colors[idx % 9]} stroke="white" strokeWidth={2} />;
                              });
                            })()}
                          </svg>
                          {/* Legend */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', flex: 1 }}>
                            {(() => {
                              const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe', '#43e97b', '#fa709a', '#fee140', '#c8b6ff'];
                              const total = categoryData.reduce((sum, [, val]) => sum + val, 0);
                              const top8 = categoryData.slice(0, 8);
                              const others = categoryData.slice(8);
                              const otherTotal = others.reduce((sum, [, val]) => sum + val, 0);
                              
                              return (
                                <>
                                  {top8.map(([name, value], idx) => {
                                    const percentage = total > 0 ? ((value / total) * 100).toFixed(0) : 0;
                                    return (
                                      <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                        <div style={{ width: 14, height: 14, background: colors[idx], borderRadius: 3, flexShrink: 0 }} />
                                        <span style={{ color: '#1f2937', fontWeight: 500, flex: 1 }}>{name}</span>
                                        <span style={{ color: '#667eea', fontWeight: 600 }}>{percentage}%</span>
                                      </div>
                                    );
                                  })}
                                  {otherTotal > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                      <div style={{ width: 14, height: 14, background: colors[8], borderRadius: 3, flexShrink: 0 }} />
                                      <span style={{ color: '#1f2937', fontWeight: 500, flex: 1 }}>Other</span>
                                      <span style={{ color: '#667eea', fontWeight: 600 }}>{total > 0 ? ((otherTotal / total) * 100).toFixed(0) : 0}%</span>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      ) : (
                        <div style={{
                          padding: 32,
                          textAlign: 'center',
                          background: '#f9fafb',
                          borderRadius: 8,
                          color: '#999'
                        }}>
                          <div style={{ fontSize: 24, marginBottom: 8 }}>📭</div>
                          <div>No {breakdownFilter.toLowerCase()} transactions yet</div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Category Breakdown Table */}
              <div style={{ flex: 1, minWidth: 320, minHeight: 0, background: 'white', borderRadius: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#333', flexShrink: 0 }}>📋 Category Summary</h4>
                {(() => {
                  const filteredData = transactions.filter(t => t.MainType === breakdownFilter);
                  const categoryData = Object.entries(
                    filteredData.reduce((acc, t) => {
                      const key = t.Category || t.Payee;
                      acc[key] = (acc[key] || 0) + Math.abs(Number(t.Total));
                      return acc;
                    }, {} as Record<string, number>)
                  ).sort((a, b) => b[1] - a[1]);

                  const total = categoryData.reduce((sum, [, val]) => sum + val, 0);

                  return categoryData.length > 0 ? (
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 120px 80px',
                        gap: '1px',
                        background: '#e5e7eb',
                        gridAutoRows: '40px'
                      }}>
                        {/* Header */}
                        <div style={{
                          background: '#f3f4f6',
                          padding: '10px 12px',
                          fontWeight: 600,
                          fontSize: 12,
                          color: '#6b7280'
                        }}>Category</div>
                        <div style={{
                          background: '#f3f4f6',
                          padding: '10px 12px',
                          fontWeight: 600,
                          fontSize: 12,
                          color: '#6b7280',
                          textAlign: 'right'
                        }}>Amount</div>
                        <div style={{
                          background: '#f3f4f6',
                          padding: '10px 12px',
                          fontWeight: 600,
                          fontSize: 12,
                          color: '#6b7280',
                          textAlign: 'right'
                        }}>%</div>

                        {/* Rows */}
                        {categoryData.map(([category, value], idx) => {
                          const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                          const isEven = idx % 2 === 0;
                          return (
                            <React.Fragment key={category}>
                              <div style={{
                                background: isEven ? '#ffffff' : '#f9fafb',
                                padding: '10px 12px',
                                fontSize: 13,
                                color: '#1f2937',
                                fontWeight: 500
                              }}>{category}</div>
                              <div style={{
                                background: isEven ? '#ffffff' : '#f9fafb',
                                padding: '10px 12px',
                                fontSize: 13,
                                color: '#374151',
                                textAlign: 'right',
                                fontWeight: 500
                              }}>${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                              <div style={{
                                background: isEven ? '#ffffff' : '#f9fafb',
                                padding: '10px 12px',
                                fontSize: 13,
                                color: '#667eea',
                                textAlign: 'right',
                                fontWeight: 600
                              }}>{percentage}%</div>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      padding: 24,
                      textAlign: 'center',
                      background: '#f9fafb',
                      borderRadius: 8,
                      color: '#999',
                      fontSize: 13
                    }}>
                      No categories to display
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Filters */}
            <div style={{
              display: 'flex',
              gap: 16,
              margin: '24px 0',
              flexWrap: 'wrap',
              background: '#f9fafb',
              padding: 16,
              borderRadius: 12
            }}>
              <div>
                <label style={{ fontSize: 12, color: '#1f2937', display: 'block', marginBottom: 6, fontWeight: 600 }}>
                  🏷️ Filter by Category
                </label>
                <select 
                  value={categoryFilter} 
                  onChange={e => setCategoryFilter(e.target.value)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '2px solid #667eea',
                    fontSize: 14,
                    cursor: 'pointer',
                    background: 'white',
                    color: '#1f2937',
                    fontWeight: 500
                  }}
                >
                  <option value="">All Categories</option>
                  {Array.from(new Set(
                    transactions
                      .filter(t => t.MainType === breakdownFilter)
                      .map(t => t.Category)
                      .filter(Boolean)
                  )).map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Transaction Table */}
            <div style={{
              background: 'white',
              borderRadius: 12,
              padding: 16,
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <h4 style={{ margin: '0 0 12px 0', color: '#333', flexShrink: 0 }}>📋 Transactions ({filteredTransactions.length})</h4>
              <div style={{ maxHeight: '400px', overflowY: 'auto', flex: 1 }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13
                }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>
                    <tr style={{ background: '#f3f4f6', borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, color: '#374151' }}>Type</th>
                      <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, color: '#374151' }}>Payee</th>
                      <th style={{ padding: 12, textAlign: 'left', fontWeight: 600, color: '#374151' }}>Category</th>
                      <th style={{ padding: 12, textAlign: 'right', fontWeight: 600, color: '#374151' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((t, i) => (
                      <tr 
                        key={i} 
                        style={{
                          borderBottom: '1px solid #f3f4f6',
                          background: i % 2 === 0 ? '#fafbfc' : 'white'
                        }}
                      >
                        <td style={{ padding: 12 }}>
                          <span style={{
                            background: t.MainType === 'Income' ? '#d1fae5' : t.MainType === 'Expense' ? '#fee2e2' : '#fef3c7',
                            color: t.MainType === 'Income' ? '#065f46' : t.MainType === 'Expense' ? '#7f1d1d' : '#92400e',
                            padding: '4px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 500
                          }}>
                            {t['Transaction Type']}
                          </span>
                        </td>
                        <td style={{ padding: 12, color: '#1f2937', fontWeight: 500 }}>{t['Payee']}</td>
                        <td style={{ padding: 12, color: '#374151' }}>{t['Category']}</td>
                        <td style={{
                          padding: 12,
                          textAlign: 'right',
                          fontWeight: 600,
                          color: Number(t.Total) > 0 ? '#10b981' : '#ef4444'
                        }}>
                          {Number(t.Total) > 0 ? '+' : ''}{Number(t.Total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </MoneyTrackerWindowContainer>
  );
};

export default MoneyTrackerWindow;
