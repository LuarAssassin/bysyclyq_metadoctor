<template>
  <section class="glass-card panel-enter">
    <header v-if="$slots.header" class="glass-card-header">
      <slot name="header" />
    </header>
    <div class="glass-card-body">
      <slot />
    </div>
  </section>
</template>
