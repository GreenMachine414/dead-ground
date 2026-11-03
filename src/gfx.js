// Graphics tiers. Low and High use the 2D renderer (Low draws fewer pixels and particles for the
// best frame rate, High is full detail); Ultra is the 3D renderer. High and Ultra still lower their
// resolution by themselves if frames run slow.
export const GFX = ['low', 'high', 'ultra'];
export const GFX_VERSION = 2; // settings version that introduced these tiers (see App.init)

// the renderer's quality mode for a tier (see Renderer.setGraphics)
export const renderQuality = (g) => (g === 'low' ? 'low' : 'auto');
