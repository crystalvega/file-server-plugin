// Bulwark Plugin: file-server-drop
// Automatic and manual offload of files to corporate temporary file-server (Mail Drop)

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

function buildEmailSnippet(uploadData, filesList) {
  const expiresDate = new Date(uploadData.expires_at).toLocaleDateString('ru-RU');
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

  const headerHtml = isMultiple
    ? `📦 Вложенные файлы (${files.length} шт., всего ${totalFormatted})`
    : `📎 Вложенный большой файл: ${escapeHtml(files[0]?.name || 'Файл')} <span style="font-weight: normal; color: #64748b;">(${formatSize(files[0]?.size || totalBytes)})</span>`;

  const headerText = isMultiple
    ? `📦 Вложенные файлы (${files.length} шт., всего ${totalFormatted}):\n${fileRowsText}`
    : `📎 Вложенный файл: ${files[0]?.name || 'Файл'} (${formatSize(files[0]?.size || totalBytes)})\n`;

  const html = `
<div style="margin: 16px 0; padding: 16px 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #0f172a;">
  <div style="font-weight: 600; font-size: 15px; margin-bottom: ${isMultiple ? '8px' : '6px'}; color: #0f172a;">
    ${headerHtml}
  </div>
  ${fileRowsHtml}
  <div style="margin-bottom: 8px; color: #334155;">
    ${isMultiple ? 'Файлы временно размещены' : 'Файл временно размещен'} на защищенном корпоративном сервере и доступен для скачивания до <b>${expiresDate}</b>.
  </div>
  <div style="margin-bottom: 8px;">
    👉 <b>Ссылка для скачивания:</b> <a href="${uploadData.url}" target="_blank" style="color: #185aea; text-decoration: underline; font-weight: 600;">${uploadData.url}</a>
  </div>
  <div>
    🔑 <b>Код доступа (PIN):</b> <span style="font-family: monospace; font-size: 15px; font-weight: 700; background-color: #e2e8f0; padding: 2px 8px; border-radius: 4px; letter-spacing: 2px; color: #0f172a;">${uploadData.pin}</span>
  </div>
</div>
`;

  const text = `\n------------------------------------------------------------\n${headerText}Файл доступен до: ${expiresDate}\n👉 Ссылка для скачивания: ${uploadData.url}\n🔑 Код доступа (PIN): ${uploadData.pin}\n------------------------------------------------------------\n`;

  return { html, text };
}

// Automatic attachment handler for files > threshold (default 20MB)
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
    return fileId;
  }

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

  if (pluginApi.toast && typeof pluginApi.toast.info === 'function') {
    pluginApi.toast.info(`Выгрузка "${file.name}" на файловый сервер...`);
  }

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
    return fileId;
  }

  if (pluginApi.toast && typeof pluginApi.toast.success === 'function') {
    pluginApi.toast.success(`Файл "${file.name}" успешно загружен на файловый сервер!`);
  }

  const snippet = buildEmailSnippet(uploadData, [{ name: file.name, size: file.size }]);

  return {
    externalAttachment: true,
    fileId: fileId,
    html: snippet.html,
    text: snippet.text,
  };
}

function registerActions(api) {
  if (!api || !api.ui || typeof api.ui.setActions !== 'function') return;

  try {
    api.ui.setActions('composer-toolbar-actions', [
      {
        id: 'upload-fileserver',
        label: 'Файловый сервер',
        icon: 'cloud-upload',
        description: 'Загрузить файлы на корпоративный файловый сервер (Mail Drop)',
        order: 10,
      },
    ]);
  } catch (e) {
    console.error('[file-server-drop] Error setting composer-toolbar-actions:', e);
  }

  try {
    api.ui.setActions('composer-attach-menu', [
      {
        id: 'upload-fileserver-menu',
        label: 'Загрузить на файловый сервер (Mail Drop)',
        icon: 'cloud-upload',
        description: 'Временное хранилище с защитой PIN-кодом',
        order: 5,
      },
    ]);
  } catch (e) {
    console.error('[file-server-drop] Error setting composer-attach-menu:', e);
  }
}

// React UI Component rendered inside PluginDialogHost modal dialog
function UploadDialog(props) {
  const h = React.createElement;
  const [files, setFiles] = React.useState([]);
  const [ttlDays, setTtlDays] = React.useState(28);
  const [customPin, setCustomPin] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [progressText, setProgressText] = React.useState('');
  const [error, setError] = React.useState(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef(null);

  const addFiles = (selectedList) => {
    if (!selectedList || selectedList.length === 0) return;
    const newArr = Array.from(selectedList);
    setFiles((prev) => {
      const existingNames = new Set(prev.map(f => f.name));
      const filtered = newArr.filter(f => !existingNames.has(f.name));
      return [...prev, ...filtered];
    });
    setError(null);
  };

  const removeFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);

  const handleStartUpload = () => {
    if (files.length === 0) {
      setError('Пожалуйста, выберите хотя бы один файл.');
      return;
    }
    setUploading(true);
    setProgress(0);
    setProgressText('Подготовка к загрузке...');
    setError(null);

    const formData = new FormData();
    for (const f of files) {
      formData.append('files', f, f.name);
    }
    formData.append('ttl_days', String(ttlDays));
    if (customPin && customPin.trim().length === 6) {
      formData.append('pin', customPin.trim());
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/files/api/upload', true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        const pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
        setProgress(pct);
        setProgressText(`Загружено ${formatSize(e.loaded)} из ${formatSize(e.total)} (${pct}%)`);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const uploadData = JSON.parse(xhr.responseText);
          const simpleFiles = files.map(f => ({ name: f.name, size: f.size }));
          if (typeof props.onResult === 'function') {
            props.onResult({ uploadData, files: simpleFiles });
          }
        } catch (e) {
          setError('Ошибка разбора ответа сервера: ' + e.message);
          setUploading(false);
        }
      } else {
        let msg = 'HTTP ' + xhr.status;
        try {
          const j = JSON.parse(xhr.responseText);
          if (j.detail) msg = j.detail;
        } catch (e) {}
        setError('Ошибка загрузки: ' + msg);
        setUploading(false);
      }
    };

    xhr.onerror = () => {
      setError('Сетевая ошибка при передаче файлов на сервер.');
      setUploading(false);
    };

    xhr.send(formData);
  };

  const handleCancel = () => {
    if (typeof props.onCancel === 'function') {
      props.onCancel();
    } else if (typeof props.onResult === 'function') {
      props.onResult(null);
    }
  };

  // Drag and drop handlers
  const onDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => {
    setIsDragging(false);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer && e.dataTransfer.files) {
      addFiles(e.dataTransfer.files);
    }
  };

  return h('div', {
    style: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      color: 'var(--foreground, #0f172a)',
      backgroundColor: 'var(--background, #ffffff)',
      padding: '20px 24px',
      maxWidth: '540px',
      margin: '0 auto',
    }
  }, [
    // Hidden File Input
    h('input', {
      key: 'hidden-input',
      ref: fileInputRef,
      type: 'file',
      multiple: true,
      style: { display: 'none' },
      onChange: (e) => {
        addFiles(e.target.files);
        e.target.value = '';
      }
    }),

    // Description text
    h('div', {
      key: 'desc',
      style: { fontSize: '13px', color: 'var(--muted-foreground, #64748b)', marginBottom: '16px' }
    }, 'Файлы будут загружены на корпоративный защищенный сервер с ограничением по времени и доступом по PIN-коду. Ссылка и код будут вставлены в письмо.'),

    // Dropzone
    !uploading ? h('div', {
      key: 'dropzone',
      onClick: () => fileInputRef.current && fileInputRef.current.click(),
      onDragOver: onDragOver,
      onDragLeave: onDragLeave,
      onDrop: onDrop,
      style: {
        border: isDragging ? '2px dashed var(--primary, #185aea)' : '2px dashed var(--border, #cbd5e1)',
        backgroundColor: isDragging ? 'var(--accent, #f1f5f9)' : 'var(--muted, #f8fafc)',
        borderRadius: '8px',
        padding: '24px 16px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        marginBottom: '16px',
      }
    }, [
      h('div', {
        key: 'cloud-icon',
        style: { fontSize: '32px', marginBottom: '8px' }
      }, '☁️'),
      h('div', {
        key: 'drop-title',
        style: { fontWeight: 600, fontSize: '14px', marginBottom: '4px', color: 'var(--foreground, #0f172a)' }
      }, 'Нажмите для выбора файлов или перетащите их сюда'),
      h('div', {
        key: 'drop-sub',
        style: { fontSize: '12px', color: 'var(--muted-foreground, #64748b)' }
      }, 'Любые типы файлов (до 5 ГБ на пакет)'),
    ]) : null,

    // Selected files list
    (files.length > 0 && !uploading) ? h('div', {
      key: 'files-box',
      style: {
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: '6px',
        padding: '8px 12px',
        marginBottom: '16px',
        maxHeight: '140px',
        overflowY: 'auto',
      }
    }, [
      h('div', {
        key: 'files-head',
        style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--muted-foreground, #64748b)' }
      }, `Выбрано файлов: ${files.length} (${formatSize(totalBytes)})`),
      ...files.map((f, idx) => h('div', {
        key: 'file-' + idx,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '13px',
          padding: '4px 0',
          borderBottom: idx < files.length - 1 ? '1px solid var(--border, #f1f5f9)' : 'none',
        }
      }, [
        h('span', {
          key: 'fn',
          style: {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '340px',
          }
        }, `📎 ${f.name}`),
        h('div', {
          key: 'actions',
          style: { display: 'flex', alignItems: 'center', gap: '8px' }
        }, [
          h('span', {
            key: 'fs',
            style: { fontSize: '12px', color: 'var(--muted-foreground, #64748b)' }
          }, formatSize(f.size)),
          h('button', {
            key: 'del',
            type: 'button',
            onClick: (e) => { e.stopPropagation(); removeFile(idx); },
            title: 'Удалить из списка',
            style: {
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--destructive, #ef4444)',
              fontWeight: 'bold',
              padding: '0 4px',
            }
          }, '✕'),
        ]),
      ])),
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
      h('label', { key: 'lbl-ttl', style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, [
        h('span', { key: 'ttl-t', style: { fontWeight: 500 } }, 'Срок хранения:'),
        h('select', {
          key: 'ttl-s',
          value: ttlDays,
          onChange: (e) => setTtlDays(Number(e.target.value)),
          style: {
            padding: '6px 8px',
            borderRadius: '6px',
            border: '1px solid var(--border, #cbd5e1)',
            backgroundColor: 'var(--background, #ffffff)',
            color: 'var(--foreground, #0f172a)',
            fontSize: '13px',
          }
        }, [
          h('option', { key: '28', value: 28 }, '28 дней (по умолчанию)'),
          h('option', { key: '14', value: 14 }, '14 дней'),
          h('option', { key: '7', value: 7 }, '7 дней'),
        ]),
      ]),

      h('label', { key: 'lbl-pin', style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, [
        h('span', { key: 'pin-t', style: { fontWeight: 500 } }, 'PIN-код (опционально):'),
        h('input', {
          key: 'pin-i',
          type: 'text',
          maxLength: 6,
          placeholder: 'Автогенерация',
          value: customPin,
          onChange: (e) => setCustomPin(e.target.value.replace(/\D/g, '')),
          style: {
            padding: '6px 8px',
            borderRadius: '6px',
            border: '1px solid var(--border, #cbd5e1)',
            backgroundColor: 'var(--background, #ffffff)',
            color: 'var(--foreground, #0f172a)',
            fontSize: '13px',
            letterSpacing: customPin ? '2px' : 'normal',
          }
        }),
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
          backgroundColor: 'var(--muted, #e2e8f0)',
          overflow: 'hidden',
          marginBottom: '8px',
        }
      }, [
        h('div', {
          key: 'prog-bar',
          style: {
            height: '100%',
            width: `${progress}%`,
            backgroundColor: 'var(--primary, #185aea)',
            transition: 'width 0.2s ease',
          }
        }),
      ]),
      h('div', {
        key: 'prog-text',
        style: {
          fontSize: '13px',
          color: 'var(--muted-foreground, #64748b)',
          textAlign: 'center',
        }
      }, progressText || 'Загрузка файлов...'),
    ]) : null,

    // Error Alert
    error ? h('div', {
      key: 'err-alert',
      style: {
        padding: '8px 12px',
        borderRadius: '6px',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        color: 'var(--destructive, #ef4444)',
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
        borderTop: '1px solid var(--border, #e2e8f0)',
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
          border: '1px solid var(--border, #cbd5e1)',
          backgroundColor: 'transparent',
          color: 'var(--foreground, #0f172a)',
          fontSize: '13px',
          cursor: uploading ? 'not-allowed' : 'pointer',
        }
      }, 'Отмена'),

      !uploading ? h('button', {
        key: 'btn-upload',
        type: 'button',
        onClick: handleStartUpload,
        disabled: files.length === 0,
        style: {
          padding: '8px 18px',
          borderRadius: '6px',
          border: 'none',
          backgroundColor: 'var(--primary, #185aea)',
          color: 'var(--primary-foreground, #ffffff)',
          fontSize: '13px',
          fontWeight: 600,
          cursor: files.length === 0 ? 'not-allowed' : 'pointer',
          opacity: files.length === 0 ? 0.6 : 1,
        }
      }, files.length > 0 ? `Загрузить ${files.length} файл(ов)` : 'Выберите файлы') : null,
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
      if (actionId === 'upload-fileserver' || actionId === 'upload-fileserver-menu') {
        const composerId = context?.composerId;
        try {
          const result = await pluginApi.ui.openDialog({
            title: 'Загрузка файлов на файловый сервер',
            slot: 'plugin-dialog',
            extraProps: { composerId },
            width: 540,
          });

          if (result && result.uploadData) {
            const { html, text } = buildEmailSnippet(result.uploadData, result.files);
            if (composerId && pluginApi.composer && typeof pluginApi.composer.replaceSelection === 'function') {
              await pluginApi.composer.replaceSelection(composerId, { html, text }, { below: true });
            }
            if (pluginApi.toast && typeof pluginApi.toast.success === 'function') {
              pluginApi.toast.success('Файлы успешно загружены на файловый сервер и ссылка добавлена в письмо!');
            }
          }
        } catch (err) {
          console.error('[file-server-drop] openDialog error:', err);
          if (pluginApi.toast && typeof pluginApi.toast.error === 'function') {
            pluginApi.toast.error('Ошибка загрузки: ' + err.message);
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
