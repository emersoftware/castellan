import { Composition, Folder, type CalculateMetadataFunction } from "remotion";
import { Highlights } from "./Highlights";
import { cutFrames, Promo, type Timelines } from "./promo/Promo";
import { PromoHorizontal, HorizontalPov, HorizontalKite, HorizontalTruce, HorizontalTowers, HorizontalCharge, HorizontalEnd } from "./promo/Horizontal";
import { INTRO_S, highlightSeconds, loadTimeline, type Timeline } from "./timeline";

type Props = { id: string; timeline?: Timeline };
const FPS = 30;

// Reads public/<id>.json (packages/sim/src/video-timeline.mts) and sizes the video to its highlights.
const calculateMetadata: CalculateMetadataFunction<Props> = async ({ props }) => {
  const timeline = await loadTimeline(props.id);
  const seconds = INTRO_S + timeline.highlights.reduce((a, h) => a + highlightSeconds(h), 0);
  return { durationInFrames: Math.round(seconds * FPS), props: { ...props, timeline } };
};

// The reel's games (public/<id>.json).
const PROMO_GAMES = ["53bed717", "eb3ebd01", "3829ed85", "c46c237a", "d0e598c5"];
const promoMetadata: CalculateMetadataFunction<{ timelines?: Timelines }> = async ({ props }) => {
  const timelines = Object.fromEntries(await Promise.all(PROMO_GAMES.map(async (id) => [id, await loadTimeline(id)])));
  return { durationInFrames: cutFrames(FPS).at(-1)!, props: { ...props, timelines } };
};

export const RemotionRoot: React.FC = () => (
  <>
  {/* Vertical reel for social feeds: moments from several games, footage at 540×960 game pixels, 2×. */}
  <Composition id="Promo" component={Promo} durationInFrames={FPS * 60} fps={FPS} width={1080} height={1920} defaultProps={{}} calculateMetadata={promoMetadata} />
  <Composition id="PromoHorizontal" component={PromoHorizontal} durationInFrames={1414} fps={30} width={1920} height={1080} defaultProps={{}} calculateMetadata={async (args) => ({ ...(await promoMetadata(args)), durationInFrames: 1414 })} />
  <Folder name="Horizontal-scenes">
    <Composition id="HorizontalPov" component={HorizontalPov} durationInFrames={171} fps={30} width={1920} height={1080} defaultProps={{}} calculateMetadata={async (args) => ({ ...(await promoMetadata(args)), durationInFrames: 171 })} />
    <Composition id="HorizontalKite" component={HorizontalKite} durationInFrames={258} fps={30} width={1920} height={1080} defaultProps={{}} calculateMetadata={async (args) => ({ ...(await promoMetadata(args)), durationInFrames: 258 })} />
    <Composition id="HorizontalTruce" component={HorizontalTruce} durationInFrames={257} fps={30} width={1920} height={1080} defaultProps={{}} calculateMetadata={async (args) => ({ ...(await promoMetadata(args)), durationInFrames: 257 })} />
    <Composition id="HorizontalTowers" component={HorizontalTowers} durationInFrames={171} fps={30} width={1920} height={1080} defaultProps={{}} calculateMetadata={async (args) => ({ ...(await promoMetadata(args)), durationInFrames: 171 })} />
    <Composition id="HorizontalCharge" component={HorizontalCharge} durationInFrames={429} fps={30} width={1920} height={1080} defaultProps={{}} calculateMetadata={async (args) => ({ ...(await promoMetadata(args)), durationInFrames: 429 })} />
    <Composition id="HorizontalEnd" component={HorizontalEnd} durationInFrames={128} fps={30} width={1920} height={1080} />
  </Folder>
  {/* 4:3 landscape; the footage is recorded at 720×540 game pixels, scaled 2×. */}
  <Composition id="Highlights" component={Highlights} durationInFrames={FPS * 60} fps={FPS} width={1440} height={1080}
    defaultProps={{ id: "d85fb193" } as Props} calculateMetadata={calculateMetadata} />
  </>
);
