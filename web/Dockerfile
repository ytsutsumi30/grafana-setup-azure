FROM nginx:1.27-alpine

COPY . /usr/share/nginx/html
COPY default.conf.template /etc/nginx/templates/default.conf.template

ENV API_UPSTREAM=http://localhost:3001
ENV GRAFANA_UPSTREAM=http://127.0.0.1:3003

EXPOSE 80
