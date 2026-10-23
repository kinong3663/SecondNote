/**
 * 没配置频道号时显示的引导页。
 *
 * 之前这里会静默退回代码里写死的 8569582（别人的频道），
 * 打开的人会看到一场不相干的课，还以为是接口坏了 —— 所以改成显式报缺。
 */
export function SetupScreen() {
  return (
    <div className="app-shell setup-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      <header className="site-header">
        <a className="brand" href="/" aria-label="秒记卡首页">
          <span className="brand__mark">
            <span />
          </span>
          <span className="brand__text">
            <strong>秒记卡</strong>
            <small>POLYV · SECOND NOTE</small>
          </span>
        </a>
      </header>

      <main className="setup-card">
        <span className="eyebrow">SETUP REQUIRED</span>
        <h1>
          还差一步：<span>配置频道号</span>
        </h1>

        <p>
          秒记卡需要知道复盘哪个频道。在 <code>秒记卡/.env.local</code> 里加一行，然后重启服务：
        </p>

        <pre>
          <code>POLYV_DEMO_CHANNEL_ID=你的频道号</code>
        </pre>

        <div className="setup-steps">
          <span>1 · 填 .env.local</span>
          <span>2 · 重启 npm start</span>
          <span>3 · 刷新本页</span>
        </div>

        <p className="setup-hint">
          频道号就是观看页地址里的那串数字：<code>https://live.polyv.cn/watch/4711207</code> →{' '}
          <code>4711207</code>
        </p>
        <p className="setup-hint">
          只想先看一眼效果，也可以直接带参数打开：<code>?channelId=4711207</code>
        </p>

        <p className="setup-foot">
          点播密钥、AI 复盘等其余配置见 <code>docs/配置说明.md</code>
        </p>
      </main>
    </div>
  );
}
