const isMcpStdioMode = process.argv.includes('--mcp-stdio');

if (isMcpStdioMode) {
  const { app } = require('electron');
  const { runBrunoMcpStdio } = require('./mcp/stdio-proxy');

  runBrunoMcpStdio()
    .then(() => app.quit())
    .catch((error) => {
      console.error(`[Bruno MCP stdio] ${error?.message || error}`);
      process.exitCode = 1;
      app.quit();
    });
} else {
  require('./desktop-main');
}
