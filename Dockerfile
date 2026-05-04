# ---- Stage : build -----

FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx nx build-container dicom-model 

# ---- Stage 2: serve ----
FROM nginx:1.27-alpine

COPY --from=build /app/dist/dicom-model/browser/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Pre-compress the mesh then remove the uncompressed version.
# Done in one RUN so both operations are in the same layer —
# the uncompressed file never persists in the final image.
RUN gzip -k /usr/share/nginx/html/heart_mesh.json \
    && rm /usr/share/nginx/html/heart_mesh.json

EXPOSE 80