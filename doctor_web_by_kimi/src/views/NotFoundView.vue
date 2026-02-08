<template>
  <div class="not-found">
    <div class="content">
      <div class="error-code">
        <span class="digit">4</span>
        <div class="ice-crystal">
          <svg viewBox="0 0 100 100">
            <polygon points="50,10 90,50 50,90 10,50" fill="none" stroke="currentColor" stroke-width="2"/>
            <line x1="50" y1="10" x2="50" y2="90" stroke="currentColor" stroke-width="1"/>
            <line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="1"/>
          </svg>
        </div>
        <span class="digit">4</span>
      </div>
      <h1 class="title">页面未找到</h1>
      <p class="description">您访问的页面已消融于冰雪之中</p>
      <el-button type="primary" size="large" @click="$router.push('/')">
        返回首页
      </el-button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.not-found {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--snow-pure);
}

.content {
  text-align: center;
}

.error-code {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 24px;
}

.digit {
  font-size: 120px;
  font-weight: 700;
  color: var(--ice-primary);
  line-height: 1;
}

.ice-crystal {
  width: 80px;
  height: 80px;
  color: var(--ice-primary-light);
  animation: rotate 8s linear infinite;
}

.title {
  font-size: 28px;
  font-weight: 600;
  color: var(--glacier-800);
  margin-bottom: 12px;
}

.description {
  color: var(--glacier-500);
  margin-bottom: 32px;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

[data-theme='dark'] .not-found {
  background: var(--glacier-950);
}

[data-theme='dark'] .title {
  color: var(--glacier-100);
}
</style>
