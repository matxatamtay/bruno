import { useCallback, useEffect, useState } from 'react';

const invokeMcp = async (channel, payload) => {
  const response = await window.ipcRenderer.invoke(channel, payload);
  if (!response?.ok) throw new Error(response?.error?.message || 'Bruno MCP operation failed');
  return response.data;
};

// Shared between the StatusBar's MCP indicator and Preferences > MCP so both reflect the same
// live server state instead of polling/listening independently.
const useMcpStatus = () => {
  const [status, setStatus] = useState(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await invokeMcp('renderer:mcp-status'));
    } catch (error) {
      setStatus({ running: false, state: 'stopped', error: error.message });
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const removeListener = window.ipcRenderer.on('main:mcp-status', (nextStatus) => setStatus(nextStatus));
    return () => removeListener?.();
  }, [refreshStatus]);

  return { status, refreshStatus, invokeMcp };
};

export default useMcpStatus;
export { invokeMcp };
