# Bulwark Mail Drop & Corporate File Server Plugin

Расширение для почтового клиента **Bulwark Webmail**, реализующее функцию **Mail Drop**: безопасную выгрузку больших файлов и вложений на изолированный корпоративный файловый сервер с ограничением по времени хранения (TTL) и защитой доступа по 6-значному PIN-коду.

---

## ✨ Основные возможности

* **Экономия почтового хранилища**: вложения не раздувают базу почтового сервера и почтовые ящики пользователей.
* **Обход лимитов почтовых провайдеров**: получатели гарантированно получат файлы, даже если их почтовый сервис не принимает письма крупнее 15-25 МБ.
* **Два режима работы**:
  * **Автоматический перехват**: при прикреплении файла больше заданного порога (по умолчанию 20 МБ) плагин вежливо предлагает выгрузить его на файловый сервер.
  * **Ручная загрузка на панели письма**: кнопка **«Файловый сервер»** в панели инструментов и в меню скрепки 📎.
* **Поддержка всех вёрсток Bulwark**:
  * Обычная вёрстка (Standard / Split / Modal).
  * Вёрстка **Mountain View** (док-окно создания письма в правом нижнем углу и развернутый режим).
* **Безопасность**:
  * Временное хранение (по умолчанию 28 дней) с автоматической очисткой диска по расписанию.
  * 6-значный PIN-код на каждый пакет файлов (вставляется в текст письма).
  * Защита от перебора паролей (Rate limiting & Lockout).
  * **Защита API сервера**: выгрузка на сервер защищена секретным API-ключом (`X-API-Key`), сторонний или анонимный доступ из интернета запрещен.
* **Нативная дизайн-система**: 
  * Модальные окна и страница скачивания автоматически наследуют цветовую тему Bulwark (светлую или тёмную).

---

## 🚀 Быстрый старт: Развертывание сервера

Файловый сервер поставляется в виде легковесного Docker-контейнера на базе FastAPI / Python 3.12.

### 1. Пример `docker-compose.yml`

```yaml
services:
  file-server:
    image: git.szma-inform.ru/mail.local/file-server:latest
    container_name: file-server
    restart: unless-stopped
    environment:
      # Внешний URL вашего почтового сервера
      - PUBLIC_BASE_URL=https://mail.example.com
      # Префикс пути (рекомендуется /file-server)
      - URL_PREFIX=/file-server
      # Секретный API-ключ для защиты от несанкционированной загрузки
      - API_KEY=your_strong_secret_api_key_here
      # Срок хранения файлов в днях
      - DEFAULT_TTL_DAYS=28
      - MAX_TTL_DAYS=28
      # Максимальный размер загружаемого файла в МБ (10240 = 10 ГБ)
      - MAX_FILE_SIZE_MB=10240
    volumes:
      - file_server_data:/data
    networks:
      - web-network

volumes:
  file_server_data:
    name: file_server_data

networks:
  web-network:
    external: true
```

### 2. Настройка Reverse Proxy

#### Nginx
```nginx
location /file-server/ {
    proxy_pass http://file-server:8000/file-server/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 10G;
    proxy_request_buffering off;
}
```

#### Traefik (Dynamic YAML)
```yaml
http:
  routers:
    file-server:
      rule: "Host(`mail.example.com`) && PathPrefix(`/file-server`)"
      entryPoints:
        - websecure
      tls: {}
      service: file-server-service

  services:
    file-server-service:
      loadBalancer:
        servers:
          - url: "http://file-server:8000"
```

#### Caddy
```caddyfile
mail.example.com {
    handle_path /file-server/* {
        reverse_proxy file-server:8000
    }
}
```

---

## 📦 Установка плагина в Bulwark Webmail

### Способ 1: Через панель администратора Bulwark
1. Скачайте архив `file-server-drop.zip` из репозитория.
2. В интерфейсе Bulwark перейдите в **Панель управления** (`/admin`) &rarr; **Плагины** &rarr; **Загрузить плагин**.
3. Загрузите архив и включите плагин.

### Способ 2: Ручная установка на сервере Bulwark
1. Скопируйте файл `index.js` в каталог данных Bulwark:
   ```bash
   cp index.js /app/data/admin/plugins/file-server-drop.js
   ```
2. Зарегистрируйте плагин в `/app/data/admin/plugins/registry.json`:
   ```json
   {
     "plugins": [
       {
         "id": "file-server-drop",
         "name": "Файловый сервер (Mail Drop)",
         "version": "1.2.0",
         "author": "SZMA Inform",
         "description": "Автоматическая и ручная выгрузка файлов на защищенный корпоративный файловый сервер",
         "type": "hook",
         "entrypoint": "index.js",
         "permissions": [
           "email:blob-read",
           "email:blob-write",
           "ui:composer-toolbar",
           "ui:observe",
           "compose:write"
         ],
         "enabled": true,
         "forceEnabled": true
       }
     ]
   }
   ```
3. Перезапустите контейнер Bulwark:
   ```bash
   docker restart bulwark
   ```

---

## ⚙️ Настройки плагина

Настройки доступны в Bulwark через **Настройки** &rarr; **Плагины** &rarr; **Файловый сервер (Mail Drop)**:

| Параметр | По умолчанию | Описание |
| :--- | :--- | :--- |
| `serverUrl` | `/file-server` | URL-эндпоинт файлового сервера (например `/file-server` или `https://files.example.com`) |
| `apiKey` | *(пусто)* | Секретный токен (`X-API-Key`), совпадающий со значением `API_KEY` на файловом сервере |
| `sizeThresholdMb` | `20` | Размер вложений в МБ, при превышении которого предлагается выгрузка на файловый сервер |
| `defaultTtlDays` | `28` | Срок хранения файлов (дней) |
| `alwaysAsk` | `true` | Показывать диалог подтверждения перед авто-выгрузкой файла |

---

## 🔒 Архитектура безопасности

1. **Песочница Bulwark**: код плагина исполняется в изолированном контексте `null-origin` и общается с почтовым клиентом только через проверенные разрешения (`compose:write`, `ui:composer-toolbar`).
2. **Защита API выгрузки**: эндпоинт `/api/upload` принимает запросы только с валидным заголовком `X-API-Key` (или `Authorization: Bearer`). Неавторизованные запросы блокируются с кодом `401 Unauthorized`.
3. **Защита доступа к файлам**: файлы скачиваются только по прямой уникальной ссылке (32-значный токен) и после корректного ввода 6-значного PIN-кода. После 5 неверных попыток ввод блокируется на 15 минут.
4. **Отсутствие публичных форм**: на главной странице файлового сервера размещена информационная заглушка; публичные анонимные формы загрузки исключены.

---

## 📄 Лицензия

MIT License &copy; 2026 SZMA Inform
