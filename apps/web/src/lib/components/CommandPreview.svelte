<script lang="ts">
  export let command = "";
  export let emptyLabel = "Command unavailable";

  type CommandToken = {
    value: string;
    kind: "space" | "executable" | "flag" | "text";
  };

  $: tokens = tokenizeCommand(command);

  function tokenizeCommand(value: string): CommandToken[] {
    let executableFound = false;

    return value.split(/(\s+)/).filter(Boolean).map((part) => {
      if (/^\s+$/.test(part)) {
        return { value: part, kind: "space" };
      }

      if (!executableFound) {
        executableFound = true;
        return { value: part, kind: "executable" };
      }

      if (part.startsWith("--")) {
        return { value: part, kind: "flag" };
      }

      return { value: part, kind: "text" };
    });
  }
</script>

<pre class:empty={!command} aria-label="Command preview"><code>{#if command}{#each tokens as token}<span class:executable={token.kind === "executable"} class:flag={token.kind === "flag"}>{token.value}</span>{/each}{:else}{emptyLabel}{/if}</code></pre>

<style>
  pre {
    min-width: 0;
    margin: 0;
    overflow: auto;
    border: 1px solid rgba(133, 153, 184, 0.16);
    border-radius: 8px;
    background: rgba(3, 7, 14, 0.74);
  }

  code {
    display: block;
    padding: 13px 14px;
    color: #cbd6e8;
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 12px;
    line-height: 1.65;
    white-space: pre;
  }

  .executable {
    color: #b893ff;
  }

  .flag {
    color: var(--color-cyan);
  }

  .empty code {
    color: #69758b;
    font-style: italic;
  }
</style>
