async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
  return response.json();
}

function indexById(items) {
  return Object.fromEntries(items.map((item) => [item.id ?? item.region_id, item]));
}

export async function loadGameData() {
  const [realms, origins, sects, shop, skills, equipment, pills, regions, manifest] = await Promise.all([
    fetchJson('./data/realms.json'),
    fetchJson('./data/origins.json'),
    fetchJson('./data/sects.json'),
    fetchJson('./data/shop.json'),
    fetchJson('./data/skills.json'),
    fetchJson('./data/equipment.json'),
    fetchJson('./data/pills.json'),
    fetchJson('./data/regions.json'),
    fetchJson('./data/generated/manifest.json')
  ]);

  const eventGroups = await Promise.all(
    manifest.files.map((file) => fetchJson(`./data/generated/${file.path}`))
  );
  const events = eventGroups.flat();
  return {
    realms,
    origins,
    sects,
    shop,
    skills,
    equipment,
    pills,
    regions,
    events,
    manifest,
    byId: {
      realm: indexById(realms),
      origin: indexById(origins),
      sect: indexById(sects),
      shop: indexById(shop),
      skill: indexById(skills),
      equipment: indexById(equipment),
      pill: indexById(pills),
      region: indexById(regions),
      event: indexById(events)
    }
  };
}
