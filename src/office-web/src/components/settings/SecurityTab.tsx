import { useEffect, useState } from 'react';
import { IconActivity, IconAlertCircle, IconCheck, IconLock, IconPlus, IconRefresh, IconShield, IconX } from '../Icons';
import { Toggle } from './Toggle';
import { btnBase, btnDanger, btnGhost, btnPrimary, cardStyle, inputStyle } from './styles';

// =========================================================================
// SecurityTab —— 安全设置面板
// =========================================================================
export interface SecurityPolicy {
  pathBlocklist: string[];
  extensionAllowlist: string[];
  extensionBlocklist: string[];
  writeRatePerMin: number;
  maxWriteBytes: number;
  maxReadBytes: number;
  approvalMode: 'auto_approve' | 'require_approval';
  sandboxEnabled: boolean;
}

export interface ApprovalItem {
  id: string;
  sessionId: string;
  action: 'write' | 'edit';
  path: string;
  before: string;
  after: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  createdAt: string;
}

export function SecurityTab() {
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [stats, setStats] = useState<{ pending: number; approvedToday: number; rejectedToday: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [newBlockEntry, setNewBlockEntry] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  // 密钥保护状态（从 /api/providers 读取，判断 api_key 是否带 enc:v1: 前缀）
  const [protectedProviders, setProtectedProviders] = useState(0);
  const [totalProviders, setTotalProviders] = useState(0);

  // 健壮性：每个接口独立 try，单接口失败不阻塞整面板；非 200 时读 error 字段
  async function safeJson(url: string): Promise<any | null> {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        const d = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(d.error || `${r.status} ${r.statusText}`);
      }
      return await r.json();
    } catch (e: any) {
      return { __error: e.message };
    }
  }

  async function loadAll() {
    const [p, a, s, provs] = await Promise.all([
      safeJson('/api/security/policy'),
      safeJson('/api/security/approvals?status=pending'),
      safeJson('/api/security/stats'),
      safeJson('/api/providers'),
    ]);

    // 路由未挂载（404）时的可操作提示——dev server 需重启加载新路由
    if (p?.__error) {
      setLoadError(`安全接口加载失败：${p.__error}。请重启 dev server（npm run web:dev）让新路由生效，再回到此页。`);
      return;
    }
    setLoadError(null);
    setPolicy(p as SecurityPolicy);
    setApprovals(Array.isArray(a) ? a : []);
    setStats(s && !s.__error ? s : null);
    const list = Array.isArray(provs) ? provs : [];
    setTotalProviders(list.length);
    setProtectedProviders(list.filter((x: any) => x.api_key && x.api_key.startsWith('enc:v1:')).length);
  }

  useEffect(() => { loadAll(); const t = setInterval(loadAll, 5000); return () => clearInterval(t); }, []);

  async function savePolicy(patch: Partial<SecurityPolicy>) {
    setBusy(true);
    try {
      const res = await fetch('/api/security/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      setPolicy(await res.json());
      setMsg('安全策略已更新');
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function approve(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/security/approvals/${id}/approve`, { method: 'POST' });
      await loadAll();
      setMsg('已批准并写入目标文件');
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  async function reject(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/security/approvals/${id}/reject`, { method: 'POST' });
      await loadAll();
      setMsg('已拒绝，目标文件未修改');
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  function addBlockEntry() {
    if (!policy || !newBlockEntry.trim()) return;
    const entry = newBlockEntry.trim();
    if (policy.pathBlocklist.includes(entry)) { setMsg('该路径已在黑名单中'); return; }
    savePolicy({ pathBlocklist: [...policy.pathBlocklist, entry] });
    setNewBlockEntry('');
  }

  function removeBlockEntry(entry: string) {
    if (!policy) return;
    savePolicy({ pathBlocklist: policy.pathBlocklist.filter(e => e !== entry) });
  }

  if (!policy) {
    if (loadError) {
      return (
        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
            <IconAlertCircle size={16} />
            <span style={{ fontWeight: 600 }}>安全面板加载失败</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8, lineHeight: 1.6 }}>{loadError}</div>
          <button onClick={loadAll} className="mc-float" style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconRefresh size={14} /> 重试
          </button>
        </div>
      );
    }
    return <div style={{ padding: 20, color: 'var(--text-3)' }}>加载安全配置中…</div>;
  }

  const protectedPct = totalProviders > 0 ? Math.round((protectedProviders / totalProviders) * 100) : 100;

  return (
    <>
      {/* ─── 安全概览卡片 ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <SecurityStatCard
          icon={<IconLock size={18} />}
          label="密钥保护"
          value={`${protectedProviders}/${totalProviders}`}
          sub={`API Key 加密存储 (${protectedPct}%)`}
          tone={protectedPct === 100 ? 'ok' : 'warn'}
        />
        <SecurityStatCard
          icon={<IconCheck size={18} />}
          label="待审批"
          value={String(stats?.pending ?? 0)}
          sub="沙箱暂存的写入变更"
          tone={(stats?.pending ?? 0) > 0 ? 'warn' : 'ok'}
        />
        <SecurityStatCard
          icon={<IconActivity size={18} />}
          label="今日审批"
          value={String((stats?.approvedToday ?? 0) + (stats?.rejectedToday ?? 0))}
          sub={`批准 ${stats?.approvedToday ?? 0} · 拒绝 ${stats?.rejectedToday ?? 0}`}
          tone="ok"
        />
        <SecurityStatCard
          icon={<IconShield size={18} />}
          label="审批模式"
          value={policy.approvalMode === 'require_approval' ? '需审批' : '自动批准'}
          sub={policy.sandboxEnabled ? '沙箱已开启' : '沙箱已关闭'}
          tone={policy.approvalMode === 'require_approval' ? 'ok' : 'warn'}
        />
      </div>

      {/* ─── 审批模式 ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <IconShield size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>审批模式</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
            <input type="radio" name="approvalMode" checked={policy.approvalMode === 'require_approval'} onChange={() => savePolicy({ approvalMode: 'require_approval' })} />
            <div>
              <div style={{ fontWeight: 600 }}>需审批（推荐）</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>AI 的 write/edit 先暂存到 .studentbuddy-sandbox/，用户在下方队列批准后才写入目标文件</div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
            <input type="radio" name="approvalMode" checked={policy.approvalMode === 'auto_approve'} onChange={() => savePolicy({ approvalMode: 'auto_approve' })} />
            <div>
              <div style={{ fontWeight: 600 }}>自动批准</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>AI 的 write/edit 直接写入目标文件（仍受路径黑名单、扩展名黑名单、写入限流约束）</div>
            </div>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <Toggle checked={policy.sandboxEnabled} onChange={(v) => savePolicy({ sandboxEnabled: v })} />
            <span style={{ fontSize: 13 }}>沙箱暂存（开启后写入先落 .studentbuddy-sandbox/，关闭则审批模式下直接拒绝写入）</span>
          </div>
        </div>
      </div>

      {/* ─── 权限矩阵 ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <IconLock size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>权限矩阵 & 限流</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>写入限流（次/分钟）</label>
            <input type="number" min={0} max={1000} value={policy.writeRatePerMin}
              onChange={(e) => { const v = parseInt(e.target.value) || 0; setPolicy({ ...policy, writeRatePerMin: v }); }}
              onBlur={(e) => savePolicy({ writeRatePerMin: parseInt(e.target.value) || 0 })}
              style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>单文件写入上限（字节）</label>
            <input type="number" min={1024} value={policy.maxWriteBytes}
              onChange={(e) => { const v = parseInt(e.target.value) || 0; setPolicy({ ...policy, maxWriteBytes: v }); }}
              onBlur={(e) => savePolicy({ maxWriteBytes: parseInt(e.target.value) || 0 })}
              style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>单文件读取上限（字节）</label>
            <input type="number" min={1024} value={policy.maxReadBytes}
              onChange={(e) => { const v = parseInt(e.target.value) || 0; setPolicy({ ...policy, maxReadBytes: v }); }}
              onBlur={(e) => savePolicy({ maxReadBytes: parseInt(e.target.value) || 0 })}
              style={inputStyle} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
          扩展名黑名单（禁止 AI 读写）：{policy.extensionBlocklist.map(e => <code key={e} style={{ background: 'var(--bg-muted)', padding: '2px 6px', borderRadius: 4, marginRight: 4, fontFamily: 'Menlo, Consolas, monospace', fontSize: 11 }}>.{e}</code>)}
        </div>
      </div>

      {/* ─── 路径黑名单 ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <IconShield size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>路径黑名单</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
          命中以下路径片段（目录名或文件名）的 AI 读写操作将被拒绝。默认包含 .env、.ssh、.aws、.git、node_modules、私钥文件。
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input type="text" value={newBlockEntry} onChange={(e) => setNewBlockEntry(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addBlockEntry(); }} placeholder="如：secrets/ 或 credentials.json" style={{ ...inputStyle, flex: 1 }} />
          <button onClick={addBlockEntry} disabled={!newBlockEntry.trim()} className="mc-float" style={{ ...btnPrimary, opacity: newBlockEntry.trim() ? 1 : 0.5 }}><IconPlus size={14} /> 添加</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {policy.pathBlocklist.map(entry => (
            <span key={entry} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-muted)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
              <code style={{ fontFamily: 'Menlo, Consolas, monospace' }}>{entry}</code>
              <button onClick={() => removeBlockEntry(entry)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--danger)', padding: '0 2px', lineHeight: 1, borderRadius: 4, transition: 'background .15s, color .15s' }} title="移除"
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger-bg)'; e.currentTarget.style.color = 'var(--danger)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>×</button>
            </span>
          ))}
        </div>
      </div>

      {/* ─── 审批队列 ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <IconActivity size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>审批队列（{approvals.length} 项待处理）</span>
          <button onClick={loadAll} className="mc-float" style={{ ...btnGhost, marginLeft: 'auto' }}><IconRefresh size={14} /> 刷新</button>
        </div>
        {approvals.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>暂无待审批的写入变更。当 AI 发起 write/edit 时，变更会出现在这里。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {approvals.map(item => (
              <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: item.action === 'write' ? 'var(--accent)' : 'var(--text-2)' }}>{item.action === 'write' ? '写入' : '编辑'}</span>
                  <code style={{ fontSize: 12, fontFamily: 'Menlo, Consolas, monospace' }}>{item.path}</code>
                  <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 'auto' }}>{new Date(item.createdAt).toLocaleTimeString()}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                  <span>会话：{item.sessionId.slice(0, 8)}…</span>
                  <span>原内容 {item.before.length} 字符 → 新内容 {item.after.length} 字符</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => approve(item.id)} disabled={busy} className="mc-float" style={{ ...btnPrimary, fontSize: 12 }}><IconCheck size={12} /> 批准写入</button>
                  <button onClick={() => reject(item.id)} disabled={busy} className="mc-float" style={{ ...btnDanger, fontSize: 12 }}><IconX size={12} /> 拒绝</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── 密钥保护状态 ─── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <IconLock size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>密钥保护状态</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
          API Key、OAuth Token、App Secret 等敏感凭证已使用 AES-256-GCM 加密存储。
          主密钥由 Windows DPAPI 保护并绑定当前 Windows 用户——即使数据库与密钥文件一并被拷走，
          到另一台机器/另一用户也无法解密（非 Windows 平台退化为本地密钥文件隔离存储）。
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
          <div>
            <span style={{ color: 'var(--text-3)' }}>服务商密钥：</span>
            <span style={{ fontWeight: 600, color: protectedPct === 100 ? 'var(--accent)' : 'var(--danger)' }}>{protectedProviders}/{totalProviders} 已加密</span>
          </div>
          {stats && (
            <div>
              <span style={{ color: 'var(--text-3)' }}>历史审批总数：</span>
              <span style={{ fontWeight: 600 }}>{stats.total}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function SecurityStatCard({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: string; sub: string; tone: 'ok' | 'warn' | 'danger';
}) {
  const toneColor = tone === 'ok' ? 'var(--accent)' : tone === 'warn' ? '#d97706' : 'var(--danger)';
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ color: toneColor, display: 'inline-flex' }}>{icon}</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{sub}</div>
    </div>
  );
}

// 保持导出统一：btnBase 供需要自定义按钮的场景使用
export { btnBase };
