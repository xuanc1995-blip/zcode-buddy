import React, { useEffect, useState } from 'react';
import { IconInfo, IconHeart, IconZap, IconFolder } from '../components/icons.jsx';

const RELEASES_URL = 'https://github.com/xuanc1995-blip/zcode-buddy/releases';

/** 更新状态 → 界面文案与可用动作 */
function updaterView(upd) {
  if (!upd) return { text: '…', actions: [] };
  if (upd.mode === 'dev') return { text: '开发模式下不可用', actions: [] };
  if (upd.mode === 'portable') return { text: '便携版不支持自动更新，请前往 Releases 页手动下载', link: true, actions: [] };
  switch (upd.state) {
    case 'checking': return { text: '正在检查更新…', actions: [] };
    case 'not-available': return { text: `已是最新版本${upd.version ? `（v${upd.version}）` : ''}`, actions: ['check'] };
    case 'available': return { text: `发现新版本 v${upd.version}`, actions: ['download', 'check'] };
    case 'downloading': return { text: `下载中 ${upd.percent != null ? `${upd.percent}%` : ''}`, progress: upd.percent, actions: [] };
    case 'downloaded': return { text: `v${upd.version} 已下载完成，可立即安装`, actions: ['install'] };
    case 'error': return { text: `检查/下载失败：${upd.error || '未知错误'}`, actions: ['check'] };
    default: return { text: '点击检查更新', actions: ['check'] };
  }
}

/** 关于页 */
export default function About({ state }) {
  const [version, setVersion] = useState('');
  const [upd, setUpd] = useState(null);
  useEffect(() => {
    window.buddy.getVersion().then(setVersion);
    window.buddy.updaterGetStatus?.().then(setUpd);
    window.buddy.on('updater:event', setUpd);
  }, []);

  const view = updaterView(upd);
  const doAct = {
    check: () => window.buddy.updaterCheck?.(),
    download: () => window.buddy.updaterDownload?.(),
    install: () => window.buddy.updaterInstall?.(),
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>关于</h1>
          <p className="page-sub">ZCode Buddy v{version || '…'}</p>
        </div>
      </header>

      <section className="panel about">
        <div className="about-hero">
          <span className="logo"><IconZap size={26} /></span>
          <div>
            <b>ZCode Buddy</b>
            <div className="hint">开源的 ZCode 多账号快捷切换与额度管理桌面工具（MIT License）</div>
          </div>
        </div>
        <p className="hint block">原理：切换 = 备份并替换 <code>~\.zcode\v2\</code> 下的登录态文件；额度通过 ZCode billing 接口实时查询。所有数据仅保存在本机。</p>

        <h2><IconZap size={15} /> 软件更新</h2>
        <p className="hint block">{view.text}</p>
        {view.progress != null && (
          <div className="model-bar" style={{ height: 8, marginBottom: 10 }}>
            <div className="model-fill" style={{ width: `${view.progress}%` }} />
          </div>
        )}
        <div className="row-gap">
          {(view.actions || []).map((a) => (
            <button key={a} className="btn" onClick={doAct[a]}>
              {a === 'check' && '检查更新'}
              {a === 'download' && '下载并安装'}
              {a === 'install' && '重启并安装'}
            </button>
          ))}
          {view.link && <a className="btn" href={RELEASES_URL} target="_blank" rel="noreferrer">前往 Releases</a>}
        </div>
      </section>

      <section className="panel about">
        <div className="row-gap">
          <a className="btn" href="https://github.com/xuanc1995-blip/zcode-buddy" target="_blank" rel="noreferrer">GitHub 仓库</a>
          <a className="btn" href={RELEASES_URL} target="_blank" rel="noreferrer">全部版本</a>
          <button className="btn ghost" onClick={() => window.buddy.openPath(state?.storeDir)}><IconFolder size={14} /> 打开数据目录</button>
        </div>
      </section>

      <section className="panel about">
        <h2><IconInfo size={15} /> 免责声明</h2>
        <p className="hint block">本项目与 ZCode / 智谱官方无任何隶属关系，仅供个人学习与效率工具使用，请遵守对应服务条款；使用本项目产生的任何后果由使用者自行承担。</p>
        <p className="hint block">设计参考了 WorkDaddy、zcode-account-switcher、ZCodex-Manager、workbuddy-switch 等优秀开源项目，感谢社区。<IconHeart size={12} /></p>
      </section>
    </div>
  );
}
