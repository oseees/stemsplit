# Dodge Dat Pothole — one static HTML file, no build step, no dependencies.
# busybox httpd is 4MB and serves index.html at / which is all this game needs.
FROM busybox:stable

WORKDIR /www
COPY index.html .

EXPOSE 8080

# $PORT is injected by Railway.
CMD ["sh", "-c", "httpd -f -v -p ${PORT:-8080} -h /www"]
