<script lang="ts">
  export let size = 36;
  export let width = size;
  export let height = size;
</script>

<svg
  class="logo-mark"
  width={width}
  height={height}
  viewBox="0 0 40 40"
  fill="none"
  aria-hidden="true"
>
  <path d="M20 3 33 10.5v15L20 37 7 25.5v-15L20 3Z" fill="#2b1b58" />
  <path d="M20 3 33 10.5 20 18 7 10.5 20 3Z" fill="#9b7cff" />
  <path d="M7 10.5 20 18v19L7 25.5v-15Z" fill="#5f3be7" />
  <path d="M33 10.5 20 18v19l13-11.5v-15Z" fill="#7d55ff" />
  <path d="M13 14 20 8.5 27 14 20 18 13 14Z" fill="#d9ccff" opacity="0.9" />
  <path d="M20 18 27 14 24 28 20 37V18Z" fill="#b394ff" opacity="0.72" />
</svg>

<style>
  .logo-mark {
    display: block;
    filter: drop-shadow(0 0 18px rgba(143, 92, 255, 0.35));
  }
</style>
