// Graphics tiers: Low draws fewer pixels and particles for the best frame rate; High is full
// detail and still lowers its resolution by itself if frames run slow.
export const GFX = ['low', 'high'];
export const GFX_VERSION = 2; // settings version that introduced these tiers (see App.init)

// the renderer's quality mode for a tier (see Renderer.setGraphics)
export const renderQuality = (g) => (g === 'low' ? 'low' : 'auto');
