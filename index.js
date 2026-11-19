// Bulwark Plugin: file-server-drop
// Offload large attachments to corporate temporary file-server

let pluginApi = null;

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function handleAttachment(fileId) {
  if (!pluginApi) return fileId;

  let file;
  try {
    file = await pluginApi.upfiles.get(fileId);
  } catch (err) {
    console.error('[file-server-drop] Error reading file:', err);
    return fileId;
  }

  if (!file) return fileId;

  // Read settings
  let thresholdMb = 20;
  let alwaysAsk = true;
  try {
    const settings = await pluginApi.settings.get();
    if (settings) {
      if (typeof settings.sizeThresholdMb === 'number') thresholdMb = settings.sizeThresholdMb;
      if (typeof settings.alwaysAsk === 'boolean') alwaysAsk = settings.alwaysAsk;
    }
  } catch (e) {}

  const thresholdBytes = thresholdMb * 1024 * 1024;
  if (file.size < thresholdBytes) {
    // Normal attachment, below threshold
    return fileId;
  }

  // Ask confirmation if configured
  if (alwaysAsk && pluginApi.ui && typeof pluginApi.ui.confirm === 'function') {
    const formattedSize = formatSize(file.size);
    const proceed = await pluginApi.ui.confirm({
      title: 'Большой файл во вложении',
      message: `Файл "${file.name}" (${formattedSize}) превышает порог ${thresholdMb} МБ.\n\nЗагрузить его на защищенный корпоративный файловый сервер?\n• Срок хранения: 28 дней\n• Защита: 6-значный PIN-код\n• Ссылка и код доступа будут автоматически добавлены в письмо.`,
      confirmLabel: 'Загрузить на файловый сервер',
      cancelLabel: 'Оставить как обычное вложение',
    });

    if (!proceed) {
      return fileId;
    }
  }

  // Notify uploading
  if (pluginApi.toast && typeof pluginApi.toast.info === 'function') {
    pluginApi.toast.info(`Выгрузка "${file.name}" на файловый сервер...`);
  }

  // Upload to corporate file-server
  const formData = new FormData();
  formData.append('files', file, file.name);
  formData.append('ttl_days', '28');

  let uploadData;
  try {
    const res = await fetch('/files/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.detail || `HTTP ${res.status}`);
    }

    uploadData = await res.json();
  } catch (err) {
    console.error('[file-server-drop] Upload failed:', err);
    if (pluginApi.toast && typeof pluginApi.toast.error === 'function') {
      pluginApi.toast.error(`Ошибка отправки на файловый сервер: ${err.message}`);
    }
    // Fall back to normal attachment if upload failed
    return fileId;
  }

  if (pluginApi.toast && typeof pluginApi.toast.success === 'function') {
    pluginApi.toast.success(`Файл "${file.name}" успешно загружен на файловый сервер!`);
  }

  const formattedSize = formatSize(file.size);
  const expiresDate = new Date(uploadData.expires_at).toLocaleDateString('ru-RU');

  const html = `
<div style="margin: 16px 0; padding: 14px 18px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #0f172a;">
  <div style="font-weight: 600; font-size: 15px; margin-bottom: 6px; color: #0f172a;">
    📎 Вложенный большой файл: ${escapeHtml(file.name)} <span style="font-weight: normal; color: #64748b;">(${formattedSize})</span>
  </div>
  <div style="margin-bottom: 8px; color: #334155;">
    Файл временно размещен на защищенном корпоративном сервере и доступен для скачивания до <b>${expiresDate}</b>.
  </div>
  <div style="margin-bottom: 6px;">
    👉 <b>Ссылка для скачивания:</b> <a href="${uploadData.url}" target="_blank" style="color: #185aea; text-decoration: underline; font-weight: 600;">${uploadData.url}</a>
  </div>
  <div>
    🔑 <b>Код доступа (PIN):</b> <span style="font-family: monospace; font-size: 15px; font-weight: 700; background-color: #e2e8f0; padding: 2px 8px; border-radius: 4px; letter-spacing: 2px; color: #0f172a;">${uploadData.pin}</span>
  </div>
</div>
`;

  const text = `\n------------------------------------------------------------\n📎 Вложенный файл: ${file.name} (${formattedSize})\nФайл доступен до: ${expiresDate}\n👉 Ссылка для скачивания: ${uploadData.url}\n🔑 Код доступа (PIN): ${uploadData.pin}\n------------------------------------------------------------\n`;

  return {
    externalAttachment: true,
    fileId: fileId,
    html: html,
    text: text,
  };
}

module.exports = {
  activate(api) {
    pluginApi = api;
    console.log('[file-server-drop] Plugin activated');
  },
  hooks: {
    async onBeforeBlobUpload(fileId) {
      return await handleAttachment(fileId);
    },
  },
};
