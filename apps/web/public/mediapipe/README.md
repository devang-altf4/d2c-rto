Model + wasm live here, served from our own origin — never a third-party CDN
that can be slow or down mid-demo.

    cd apps/web/public/mediapipe
    curl -O https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
    cp -r ../../../../node_modules/.pnpm/@mediapipe+tasks-vision*/node_modules/@mediapipe/tasks-vision/wasm .

Use the LITE model. Full is ~4x larger for accuracy that does not change which
of five size buckets she lands in.
