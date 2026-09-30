# Denis promo video

The 20-second promo shown in the main README, built with [Remotion](https://www.remotion.dev/)
(React + TypeScript). Numbers on screen come from `src/data.ts`, which mirrors the recorded
results in [`../benchmarks/results`](../benchmarks/results) and the terminal output of a real
`denis cli exec` session, so update it when those change.

```sh
cd promo && npm install
npm run studio        # live preview with a timeline
npm run render        # ../docs/assets/denis-promo.mp4   (1920x1080, 30 fps, H.264)
npm run still         # ../docs/assets/denis-promo-poster.png
```

Remotion is free for individuals and companies of up to three people; check
[its license](https://www.remotion.dev/docs/license) before using this in a larger team.
