// Bulwark Plugin: file-server-drop
// Automatic and manual offload of files to corporate temporary file-server (Mail Drop)

let pluginApi = null;

function getLocale() {
  if (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) {
    if (document.documentElement.lang.startsWith('ru')) return 'ru';
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    if (navigator.language.startsWith('ru')) return 'ru';
  }
  return 'en';
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const isRu = getLocale() === 'ru';
  const units = isRu ? ['Б', 'КБ', 'МБ', 'ГБ'] : ['B', 'KB', 'MB', 'GB'];
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

const DEFAULT_API_KEY = 'szma_drop_8f4a1c6e2b9d03e57a81c2d4';
const DEFAULT_SERVER_URL = '/file-server';

async function getPluginConfig() {
  let serverUrl = DEFAULT_SERVER_URL;
  let apiKey = DEFAULT_API_KEY;
  let thresholdMb = 20;
  let defaultTtlDays = 28;
  let alwaysAsk = true;

  // 1. Read global admin configuration (configSchema)
  if (pluginApi && pluginApi.config && typeof pluginApi.config.get === 'function') {
    try {
      const cfg = await pluginApi.config.get();
      if (cfg) {
        if (typeof cfg.serverUrl === 'string' && cfg.serverUrl.trim()) {
          serverUrl = cfg.serverUrl.trim().replace(/\/+$/, '');
        }
        if (typeof cfg.apiKey === 'string' && cfg.apiKey.trim()) {
          apiKey = cfg.apiKey.trim();
        }
      }
    } catch (e) {}
  }

  // 2. Read user preferences (settingsSchema)
  if (pluginApi && pluginApi.settings && typeof pluginApi.settings.get === 'function') {
    try {
      const s = await pluginApi.settings.get();
      if (s) {
        if (typeof s.sizeThresholdMb === 'number') thresholdMb = s.sizeThresholdMb;
        if (typeof s.defaultTtlDays === 'number') defaultTtlDays = s.defaultTtlDays;
        if (typeof s.alwaysAsk === 'boolean') alwaysAsk = s.alwaysAsk;
      }
    } catch (e) {}
  }
  return { serverUrl, apiKey, thresholdMb, defaultTtlDays, alwaysAsk };
}

function buildEmailSnippet(uploadData, filesList) {
  const isRu = getLocale() === 'ru';
  const expiresDate = new Date(uploadData.expires_at).toLocaleDateString(isRu ? 'ru-RU' : 'en-US', {
    year: 'numeric',
    month: isRu ? 'numeric' : 'short',
    day: 'numeric',
  });
  const files = (filesList && filesList.length > 0)
    ? filesList
    : (uploadData.files && uploadData.files.length > 0)
      ? uploadData.files
      : [];

  const isMultiple = files.length > 1;
  const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
  const totalFormatted = formatSize(totalBytes);

  let fileRowsHtml = '';
  let fileRowsText = '';

  if (isMultiple) {
    fileRowsHtml = '<ul style="margin: 0 0 12px 0; padding-left: 20px; color: #334155; font-size: 13px;">' +
      files.map(f => `<li style="margin-bottom: 4px;"><b>${escapeHtml(f.name)}</b> <span style="color: #64748b;">(${formatSize(f.size)})</span></li>`).join('') +
      '</ul>';
    fileRowsText = files.map(f => `  • ${f.name} (${formatSize(f.size)})`).join('\n') + '\n';
  }

  const headerHtml = isRu
    ? (isMultiple
        ? `📦 Вложенные файлы (${files.length} шт., всего ${totalFormatted})`
        : `📎 Вложенный большой файл: ${escapeHtml(files[0]?.name || 'Файл')} <span style="font-weight: normal; color: #64748b;">(${formatSize(files[0]?.size || totalBytes)})</span>`)
    : (isMultiple
        ? `📦 Attached Files (${files.length} items, total ${totalFormatted})`
        : `📎 Large Attached File: ${escapeHtml(files[0]?.name || 'File')} <span style="font-weight: normal; color: #64748b;">(${formatSize(files[0]?.size || totalBytes)})</span>`);

  const headerText = isRu
    ? (isMultiple
        ? `📦 Вложенные файлы (${files.length} шт., всего ${totalFormatted}):\n${fileRowsText}`
        : `📎 Вложенный файл: ${files[0]?.name || 'Файл'} (${formatSize(files[0]?.size || totalBytes)})\n`)
    : (isMultiple
        ? `📦 Attached Files (${files.length} items, total ${totalFormatted}):\n${fileRowsText}`
        : `📎 Attached File: ${files[0]?.name || 'File'} (${formatSize(files[0]?.size || totalBytes)})\n`);

  const descHtml = isRu
    ? `${isMultiple ? 'Файлы временно размещены' : 'Файл временно размещен'} на защищенном корпоративном сервере и доступен для скачивания до <b>${expiresDate}</b>.`
    : `${isMultiple ? 'Files are temporarily hosted' : 'File is temporarily hosted'} on the secure corporate file server and available for download until <b>${expiresDate}</b>.`;

  const linkLabelHtml = isRu ? '👉 <b>Ссылка для скачивания:</b>' : '👉 <b>Download link:</b>';
  const pinLabelHtml = isRu ? '🔑 <b>Код доступа (PIN):</b>' : '🔑 <b>Access Code (PIN):</b>';

  const html = `
<div style="margin: 16px 0; padding: 16px 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #0f172a;">
  <div style="font-weight: 600; font-size: 15px; margin-bottom: ${isMultiple ? '8px' : '6px'}; color: #0f172a;">
    ${headerHtml}
  </div>
  ${fileRowsHtml}
  <div style="margin-bottom: 8px; color: #334155;">
    ${descHtml}
  </div>
  <div style="margin-bottom: 8px;">
    ${linkLabelHtml} <a href="${uploadData.url}" target="_blank" style="color: #185aea; text-decoration: underline; font-weight: 600;">${uploadData.url}</a>
  </div>
  <div>
    ${pinLabelHtml} <span style="font-family: monospace; font-size: 15px; font-weight: 700; background-color: #e2e8f0; padding: 2px 8px; border-radius: 4px; letter-spacing: 2px; color: #0f172a;">${uploadData.pin}</span>
  </div>
</div>
`;

  const text = isRu
    ? `\n------------------------------------------------------------\n${headerText}Файл доступен до: ${expiresDate}\n👉 Ссылка для скачивания: ${uploadData.url}\n🔑 Код доступа (PIN): ${uploadData.pin}\n------------------------------------------------------------\n`
    : `\n------------------------------------------------------------\n${headerText}Available until: ${expiresDate}\n👉 Download link: ${uploadData.url}\n🔑 Access code (PIN): ${uploadData.pin}\n------------------------------------------------------------\n`;

  return { html, text };
}

// Automatic attachment handler for files > threshold (default 20 MB)
async function handleAttachment(fileId) {
  if (!pluginApi || !pluginApi.blobs) return null;

  try {
    const file = await pluginApi.blobs.get(fileId);
    if (!file || !file.size) return null;

    const config = await getPluginConfig();
    const thresholdBytes = config.thresholdMb * 1024 * 1024;

    if (file.size < thresholdBytes) {
      return null;
    }

    const isRu = getLocale() === 'ru';

    if (config.alwaysAsk && pluginApi.ui && typeof pluginApi.ui.confirm === 'function') {
      const formattedSize = formatSize(file.size);
      const question = isRu
        ? `Файл "${file.name}" имеет размер ${formattedSize}, что превышает рекомендованный лимит для почты (${config.thresholdMb} МБ).\n\nЗагрузить его на корпоративный файловый сервер и вставить защищенную ссылку с PIN-кодом?`
        : `File "${file.name}" is ${formattedSize}, which exceeds the recommended email limit (${config.thresholdMb} MB).\n\nUpload it to corporate file server and insert a secure PIN-protected link?`;

      const shouldUpload = await pluginApi.ui.confirm({
        title: isRu ? 'Большой файл' : 'Large Attachment',
        message: question,
        confirmLabel: isRu ? 'Выгрузить на сервер' : 'Upload to File Server',
        cancelLabel: isRu ? 'Прикрепить обычно' : 'Attach Normally',
      });

      if (!shouldUpload) {
        return null;
      }
    }

    if (pluginApi.toast && typeof pluginApi.toast.info === 'function') {
      pluginApi.toast.info(isRu ? `Выгрузка файла "${file.name}" на файловый сервер...` : `Uploading "${file.name}" to file server...`);
    }

    const formData = new FormData();
    const blob = await pluginApi.blobs.read(fileId);
    formData.append('files', blob, file.name);
    formData.append('ttl_days', String(config.defaultTtlDays));

    const uploadUrl = `${config.serverUrl}/api/upload`;
    const headers = {};
    if (config.apiKey) {
      headers['X-API-Key'] = config.apiKey;
    }

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server returned HTTP ${response.status}: ${errText}`);
    }

    const result = await response.json();
    const { html, text } = buildEmailSnippet(result, [{ name: file.name, size: file.size }]);

    if (pluginApi.composer && typeof pluginApi.composer.insertText === 'function') {
      await pluginApi.composer.insertText({ html, text });
    }

    if (pluginApi.toast && typeof pluginApi.toast.success === 'function') {
      pluginApi.toast.success(isRu ? `Файл "${file.name}" успешно загружен на файловый сервер!` : `File "${file.name}" successfully uploaded to file server!`);
    }

    return { cancelUpload: true };
  } catch (err) {
    console.error('[file-server-drop] Intercept upload error:', err);
    const isRu = getLocale() === 'ru';
    if (pluginApi.toast && typeof pluginApi.toast.error === 'function') {
      pluginApi.toast.error(isRu ? `Ошибка выгрузки на файловый сервер: ${err.message}` : `Failed to upload to file server: ${err.message}`);
    }
    return null;
  }
}

function registerActions(api) {
  if (!api || !api.ui || typeof api.ui.setActions !== 'function') {
    console.warn('[file-server-drop] api.ui.setActions is not available');
    return;
  }

  const isRu = getLocale() === 'ru';

  try {
    api.ui.setActions('composer-toolbar-actions', [
      {
        id: 'upload-fileserver',
        label: isRu ? 'Файловый сервер' : 'File Server',
        description: isRu ? 'Выгрузка файлов на защищенный корпоративный сервер (Mail Drop)' : 'Upload large files to secure corporate file server (Mail Drop)',
        icon: 'cloud-upload',
        order: 10,
      }
    ]);
  } catch (err) {
    console.error('[file-server-drop] Failed to set composer-toolbar-actions:', err);
  }

  try {
    api.ui.setActions('composer-attach-menu', [
      {
        id: 'upload-fileserver-menu',
        label: isRu ? 'Загрузить на файловый сервер (Mail Drop)' : 'Upload to File Server (Mail Drop)',
        description: isRu ? 'Временное хранилище файлов с защитой PIN-кодом' : 'Temporary file storage protected with PIN code',
        icon: 'cloud-upload',
        order: 1,
      }
    ]);
  } catch (err) {
    console.error('[file-server-drop] Failed to set composer-attach-menu:', err);
  }

  try {
    api.ui.setActions('composer-header-actions', [
      {
        id: 'upload-fileserver-header',
        label: isRu ? 'Файловый сервер (Mail Drop)' : 'File Server (Mail Drop)',
        description: isRu ? 'Выгрузка файлов на защищенный корпоративный сервер' : 'Upload files to corporate secure server',
        icon: 'cloud-upload',
        order: 1,
      }
    ]);
  } catch (err) {
    console.error('[file-server-drop] Failed to set composer-header-actions:', err);
  }
}

// React modal component for uploading files
function UploadDialog(props) {
  const _React = (typeof React !== 'undefined' && React) ||
                 (typeof require === 'function' && require('react')) ||
                 (typeof window !== 'undefined' && window.React);
  if (!_React) {
    return null;
  }

  const { useState, useRef, createElement: h } = _React;
  const isRu = getLocale() === 'ru';

  const [files, setFiles] = useState([]);
  const [ttlDays, setTtlDays] = useState(props.defaultTtlDays || 28);
  const [pin, setPin] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef(null);
  const serverUrl = (props.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');
  const apiKey = props.apiKey || DEFAULT_API_KEY;

  const closeWithResult = (res) => {
    if (typeof props.onResult === 'function') {
      props.onResult(res);
    } else if (typeof props.onClose === 'function') {
      props.onClose(res);
    }
  };

  const handleFileChange = (e) => {
    if (e.target && e.target.files) {
      const selected = Array.from(e.target.files);
      setFiles(prev => [...prev, ...selected]);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer && e.dataTransfer.files) {
      const dropped = Array.from(e.dataTransfer.files);
      setFiles(prev => [...prev, ...dropped]);
    }
  };

  const removeFile = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleStartUpload = () => {
    if (files.length === 0) {
      setError(isRu ? 'Пожалуйста, выберите хотя бы один файл.' : 'Please select at least one file.');
      return;
    }

    setUploading(true);
    setProgress(0);
    setProgressText(isRu ? 'Подготовка к выгрузке...' : 'Preparing upload...');
    setError(null);

    const formData = new FormData();
    files.forEach(f => {
      formData.append('files', f, f.name);
    });
    formData.append('ttl_days', String(ttlDays));
    if (pin && pin.trim().length === 6) {
      formData.append('pin', pin.trim());
    }

    const xhr = new XMLHttpRequest();
    const endpoint = `${serverUrl}/api/upload`;
    xhr.open('POST', endpoint, true);

    if (apiKey) {
      xhr.setRequestHeader('X-API-Key', apiKey);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        setProgress(pct);
        setProgressText(isRu ? `Отправка: ${pct}% (${formatSize(evt.loaded)} из ${formatSize(evt.total)})` : `Uploading: ${pct}% (${formatSize(evt.loaded)} of ${formatSize(evt.total)})`);
      } else {
        setProgressText(isRu ? 'Загрузка файлов на сервер...' : 'Uploading files to server...');
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText);
          closeWithResult({
            uploadData: resp,
            files: files.map(f => ({ name: f.name, size: f.size })),
          });
        } catch (e) {
          setError((isRu ? 'Ошибка разбора ответа сервера: ' : 'Failed to parse server response: ') + e.message);
          setUploading(false);
        }
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          const json = JSON.parse(xhr.responseText);
          msg = json.detail || json.message || msg;
        } catch (e) {
          msg = xhr.responseText || msg;
        }
        setError((isRu ? 'Ошибка загрузки: ' : 'Upload error: ') + msg);
        setUploading(false);
      }
    };

    xhr.onerror = () => {
      setError(isRu ? 'Сетевая ошибка при передаче файлов на сервер.' : 'Network error while transferring files to server.');
      setUploading(false);
    };

    xhr.send(formData);
  };

  const handleCancel = () => {
    closeWithResult(null);
  };

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const totalFormatted = formatSize(totalBytes);

  return h('div', {
    style: {
      padding: '4px 0 0 0',
      fontFamily: 'inherit',
      fontSize: '14px',
      color: 'var(--color-foreground, inherit)',
      background: 'transparent',
    }
  }, [
    // Subtitle
    h('p', {
      key: 'desc',
      style: {
        margin: '0 0 16px 0',
        fontSize: '13px',
        color: 'var(--color-muted-foreground, #a1a1aa)',
        lineHeight: '1.4',
      }
    }, isRu
      ? 'Файлы будут загружены на корпоративный защищенный сервер с ограничением по времени и доступом по PIN-коду. Ссылка и код будут вставлены в письмо.'
      : 'Files will be uploaded to the corporate secure server with temporary retention and PIN access. The link and code will be inserted into the email.'),

    // Dropzone
    !uploading ? h('div', {
      key: 'dropzone',
      onClick: () => fileInputRef.current && fileInputRef.current.click(),
      onDragOver: (e) => { e.preventDefault(); setDragOver(true); },
      onDragLeave: () => setDragOver(false),
      onDrop: handleDrop,
      style: {
        border: `2px dashed ${dragOver ? 'var(--color-primary, #3b82f6)' : 'var(--color-border, rgba(120, 120, 120, 0.3))'}`,
        borderRadius: '8px',
        padding: '28px 16px',
        textAlign: 'center',
        cursor: 'pointer',
        backgroundColor: dragOver ? 'var(--color-accent, rgba(59, 130, 246, 0.1))' : 'var(--color-card, rgba(120, 120, 120, 0.05))',
        transition: 'all 0.15s ease',
        marginBottom: '16px',
      }
    }, [
      h('input', {
        key: 'input',
        type: 'file',
        multiple: true,
        ref: fileInputRef,
        onChange: handleFileChange,
        style: { display: 'none' },
      }),
      h('div', {
        key: 'icon-cloud',
        style: {
          width: '40px',
          height: '40px',
          margin: '0 auto 10px auto',
          color: 'var(--color-muted-foreground, #a1a1aa)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }
      }, [
        h('svg', {
          key: 'svg',
          width: 36,
          height: 36,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.75,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        }, [
          h('path', { key: 'p1', d: 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242' }),
          h('path', { key: 'p2', d: 'M12 12v9' }),
          h('path', { key: 'p3', d: 'm16 16-4-4-4 4' }),
        ])
      ]),
      h('div', {
        key: 'drop-title',
        style: { fontWeight: 600, fontSize: '14px', marginBottom: '4px', color: 'var(--color-foreground, inherit)' }
      }, isRu ? 'Нажмите для выбора файлов или перетащите их сюда' : 'Click to select files or drag & drop here'),
      h('div', {
        key: 'drop-sub',
        style: { fontSize: '12px', color: 'var(--color-muted-foreground, #a1a1aa)' }
      }, isRu ? 'Любые типы файлов (до 10 ГБ на пакет)' : 'Any file types (up to 10 GB per bundle)'),
    ]) : null,

    // File list preview
    (files.length > 0 && !uploading) ? h('div', {
      key: 'file-list-wrap',
      style: {
        marginBottom: '16px',
        maxHeight: '160px',
        overflowY: 'auto',
        border: '1px solid var(--color-border, rgba(120, 120, 120, 0.2))',
        borderRadius: '6px',
        backgroundColor: 'var(--color-card, rgba(120, 120, 120, 0.05))',
      }
    }, [
      h('div', {
        key: 'list-header',
        style: {
          padding: '8px 12px',
          fontSize: '12px',
          fontWeight: 600,
          borderBottom: '1px solid var(--color-border, rgba(120, 120, 120, 0.2))',
          color: 'var(--color-muted-foreground, #a1a1aa)',
          display: 'flex',
          justifyContent: 'space-between',
        }
      }, [
        h('span', { key: 't1' }, isRu ? `Выбранные файлы: ${files.length} (${totalFormatted})` : `Selected files: ${files.length} (${totalFormatted})`),
      ]),
      ...files.map((f, i) => h('div', {
        key: 'file-' + i,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: i < files.length - 1 ? '1px solid var(--color-border, rgba(120, 120, 120, 0.15))' : 'none',
          fontSize: '13px',
        }
      }, [
        h('div', {
          key: 'info',
          style: { minWidth: 0, flex: 1, marginRight: '10px' }
        }, [
          h('div', {
            key: 'fn',
            style: {
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: 'var(--color-foreground, inherit)',
            }
          }, f.name),
          h('div', {
            key: 'fs',
            style: { fontSize: '11px', color: 'var(--color-muted-foreground, #a1a1aa)' }
          }, formatSize(f.size)),
        ]),
        h('button', {
          key: 'del',
          type: 'button',
          onClick: () => removeFile(i),
          title: isRu ? 'Удалить из списка' : 'Remove from list',
          style: {
            background: 'transparent',
            border: 'none',
            color: 'var(--color-destructive, #ef4444)',
            cursor: 'pointer',
            padding: '4px',
            fontSize: '16px',
            lineHeight: 1,
          }
        }, '✕'),
      ]))
    ]) : null,

    // Settings (TTL & PIN)
    !uploading ? h('div', {
      key: 'settings-grid',
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        marginBottom: '16px',
        fontSize: '13px',
      }
    }, [
      // TTL Select
      h('div', { key: 'ttl-col' }, [
        h('label', {
          key: 'ttl-lbl',
          style: { display: 'block', marginBottom: '6px', color: 'var(--color-foreground, inherit)' }
        }, [
          h('span', { key: 'ttl-t', style: { fontWeight: 500 } }, isRu ? 'Срок хранения:' : 'Retention period:'),
        ]),
        h('select', {
          key: 'ttl-sel',
          value: ttlDays,
          onChange: (e) => setTtlDays(parseInt(e.target.value, 10)),
          style: {
            width: '100%',
            padding: '8px 10px',
            borderRadius: '6px',
            border: '1px solid var(--color-input, var(--color-border, rgba(120, 120, 120, 0.3)))',
            backgroundColor: 'var(--color-input, rgba(120, 120, 120, 0.1))',
            color: 'var(--color-foreground, inherit)',
            fontSize: '13px',
            outline: 'none',
          }
        }, [
          h('option', { key: '28', value: 28 }, isRu ? '28 дней (по умолчанию)' : '28 days (default)'),
          h('option', { key: '14', value: 14 }, isRu ? '14 дней' : '14 days'),
          h('option', { key: '7', value: 7 }, isRu ? '7 дней' : '7 days'),
          h('option', { key: '3', value: 3 }, isRu ? '3 дня' : '3 days'),
          h('option', { key: '1', value: 1 }, isRu ? '1 день' : '1 day'),
        ])
      ]),

      // Custom PIN (Optional)
      h('div', { key: 'pin-col' }, [
        h('label', {
          key: 'pin-lbl',
          style: { display: 'block', marginBottom: '6px', color: 'var(--color-foreground, inherit)' }
        }, [
          h('span', { key: 'pin-t', style: { fontWeight: 500 } }, isRu ? 'PIN-код (опционально):' : 'PIN code (optional):'),
        ]),
        h('input', {
          key: 'pin-inp',
          type: 'text',
          maxLength: 6,
          pattern: '[0-9]{6}',
          placeholder: isRu ? 'Автогенерация' : 'Auto-generated',
          value: pin,
          onChange: (e) => setPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)),
          style: {
            width: '100%',
            padding: '8px 10px',
            borderRadius: '6px',
            border: '1px solid var(--color-input, var(--color-border, rgba(120, 120, 120, 0.3)))',
            backgroundColor: 'var(--color-input, rgba(120, 120, 120, 0.1))',
            color: 'var(--color-foreground, inherit)',
            fontSize: '13px',
            fontFamily: 'monospace',
            outline: 'none',
            letterSpacing: '1px',
            boxSizing: 'border-box',
          }
        })
      ]),
    ]) : null,

    // Progress Bar during upload
    uploading ? h('div', {
      key: 'prog-wrap',
      style: { margin: '20px 0' }
    }, [
      h('div', {
        key: 'prog-track',
        style: {
          height: '8px',
          borderRadius: '4px',
          backgroundColor: 'var(--color-muted, rgba(120, 120, 120, 0.2))',
          overflow: 'hidden',
          marginBottom: '8px',
        }
      }, [
        h('div', {
          key: 'prog-bar',
          style: {
            height: '100%',
            width: `${progress}%`,
            backgroundColor: 'var(--color-primary, #3b82f6)',
            transition: 'width 0.2s ease',
          }
        }),
      ]),
      h('div', {
        key: 'prog-text',
        style: {
          fontSize: '13px',
          color: 'var(--color-muted-foreground, #a1a1aa)',
          textAlign: 'center',
        }
      }, progressText || (isRu ? 'Загрузка файлов на сервер...' : 'Uploading files to server...')),
    ]) : null,

    // Error Alert
    error ? h('div', {
      key: 'err-alert',
      style: {
        padding: '8px 12px',
        borderRadius: '6px',
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        color: 'var(--color-destructive, #ef4444)',
        fontSize: '13px',
        marginBottom: '16px',
      }
    }, error) : null,

    // Bottom Action Buttons
    h('div', {
      key: 'footer-btns',
      style: {
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: '8px',
        marginTop: '16px',
        paddingTop: '12px',
        borderTop: '1px solid var(--color-border, rgba(120, 120, 120, 0.2))',
      }
    }, [
      h('button', {
        key: 'btn-cancel',
        type: 'button',
        onClick: handleCancel,
        disabled: uploading,
        style: {
          padding: '8px 16px',
          borderRadius: '6px',
          border: '1px solid var(--color-border, rgba(120, 120, 120, 0.3))',
          backgroundColor: 'transparent',
          color: 'var(--color-foreground, inherit)',
          fontSize: '13px',
          cursor: uploading ? 'not-allowed' : 'pointer',
        }
      }, isRu ? 'Отмена' : 'Cancel'),

      !uploading ? h('button', {
        key: 'btn-upload',
        type: 'button',
        onClick: handleStartUpload,
        disabled: files.length === 0,
        style: {
          padding: '8px 18px',
          borderRadius: '6px',
          border: 'none',
          backgroundColor: 'var(--color-primary, #185aea)',
          color: 'var(--color-primary-foreground, #ffffff)',
          fontSize: '13px',
          fontWeight: 600,
          cursor: files.length === 0 ? 'not-allowed' : 'pointer',
          opacity: files.length === 0 ? 0.6 : 1,
        }
      }, files.length > 0 ? (isRu ? `Загрузить ${files.length} файл(ов)` : `Upload ${files.length} file(s)`) : (isRu ? 'Выберите файлы' : 'Select files')) : null,
    ]),
  ]);
}

module.exports = {
  activate(api) {
    pluginApi = api;
    registerActions(api);
    console.log('[file-server-drop] Plugin activated');
  },

  hooks: {
    async onBeforeBlobUpload(fileId) {
      return await handleAttachment(fileId);
    },

    async onAction({ surface, actionId, context }) {
      if (actionId === 'upload-fileserver' || actionId === 'upload-fileserver-menu' || actionId === 'upload-fileserver-header') {
        const composerId = context?.composerId;
        const isRu = getLocale() === 'ru';
        try {
          const config = await getPluginConfig();
          const result = await pluginApi.ui.openDialog({
            title: isRu ? 'Загрузка файлов на файловый сервер' : 'Upload Files to File Server',
            slot: 'plugin-dialog',
            extraProps: {
              composerId,
              serverUrl: config.serverUrl,
              apiKey: config.apiKey,
              defaultTtlDays: config.defaultTtlDays,
            },
            width: 540,
          });

          if (result && result.uploadData) {
            const { html, text } = buildEmailSnippet(result.uploadData, result.files);
            if (composerId && pluginApi.composer && typeof pluginApi.composer.replaceSelection === 'function') {
              await pluginApi.composer.replaceSelection(composerId, { html, text }, { below: true });
            } else if (composerId && pluginApi.composer && typeof pluginApi.composer.insertText === 'function') {
              await pluginApi.composer.insertText({ html, text });
            }
            if (pluginApi.toast && typeof pluginApi.toast.success === 'function') {
              pluginApi.toast.success(isRu ? 'Файлы успешно загружены и ссылка добавлена в письмо!' : 'Files successfully uploaded and link added to message!');
            }
          }
        } catch (err) {
          console.error('[file-server-drop] openDialog error:', err);
          if (pluginApi.toast && typeof pluginApi.toast.error === 'function') {
            pluginApi.toast.error(isRu ? ('Ошибка загрузки: ' + err.message) : ('Upload failed: ' + err.message));
          }
        }
      }
    },
  },

  slots: {
    'plugin-dialog': {
      component: UploadDialog,
    },
  },
};
