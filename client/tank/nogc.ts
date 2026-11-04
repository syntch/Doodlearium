/**
 * Pixi frees the graphics card's copy of anything not drawn for a minute, and rebuilds it when it's next
 * needed. In Firefox, shapes left undrawn a while (the map's nebula circles, creatures in a place) came
 * back as long stretched shards, most likely from that rebuild. Doodlearium frees creatures and pictures
 * itself as they leave, so the automatic clean-up is turned off.
 */
export const NO_GC = { gcActive: false } as const;
