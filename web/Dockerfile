FROM nginx:1.27-alpine

COPY . /usr/share/nginx/html
COPY default.conf.template /etc/nginx/templates/default.conf.template

ENV API_UPSTREAM=http://localhost:3001

EXPOSE 80