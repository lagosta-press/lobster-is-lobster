FROM nginxinc/nginx-unprivileged:1.30.4-alpine-slim

COPY --chmod=644 index.html /usr/share/nginx/html/index.html
COPY --chmod=644 favicon.ico /usr/share/nginx/html/favicon.ico
COPY --chmod=644 favicon-32x32.png /usr/share/nginx/html/favicon-32x32.png
COPY --chmod=644 favicon-16x16.png /usr/share/nginx/html/favicon-16x16.png
COPY --chmod=644 apple-touch-icon.png /usr/share/nginx/html/apple-touch-icon.png

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]
