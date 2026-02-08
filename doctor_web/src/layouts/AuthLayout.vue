<template>
  <div class="auth-shell">
    <div class="auth-shape auth-shape-a" />
    <div class="auth-shape auth-shape-b" />
    <div class="auth-grid">
      <section class="auth-brand panel-enter">
        <p class="auth-brand-kicker">Peking University Third Hospital</p>
        <h1>医生元宇宙智能体</h1>
        <p>
          一个面向临床医生的知识沉淀、数字人素材、叙事底座和 AI 问诊演练协同平台。
        </p>
        <ul>
          <li>知识库异步抽取与索引检索</li>
          <li>医生音色 + 场景视频素材统一管理</li>
          <li>叙事底座与红线规则可解释化迭代</li>
          <li>流式问诊演练 + Markdown 批改闭环</li>
        </ul>
      </section>
      <section class="auth-panel panel-enter">
        <router-view />
      </section>
    </div>
  </div>
</template>
