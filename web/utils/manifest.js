function toAbsoluteUrl(value) {
    return new URL(value, window.location.href).href;
}

function updateAssetUrls(value) {
    if (Array.isArray(value)) {
        value.forEach(updateAssetUrls);
        return;
    }

    if (!value || typeof value !== 'object') return;

    Object.entries(value).forEach(([key, childValue]) => {
        if (key === 'src' && typeof childValue === 'string') {
            value[key] = toAbsoluteUrl(childValue);
            return;
        }

        updateAssetUrls(childValue);
    });
}

function getManifestLink() {
    let link = document.querySelector('link[rel="manifest"]');
    if (link) return link;

    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
    return link;
}

export async function makeManifest(url) {
    try {
        const response = await fetch(url, {cache: 'no-cache'});
        if (!response.ok) throw new Error(response.statusText || 'Unable to load manifest');

        const manifest = await response.json();
        updateAssetUrls(manifest);

        manifest.start_url = window.location.href;
        manifest.scope = new URL(manifest.scope || './', window.location.href).href;

        getManifestLink().href = `data:application/manifest+json;charset=utf-8,${
            encodeURIComponent(JSON.stringify(manifest, null, 2))
        }`;
    } catch (error) {
        console.error('Unable to load manifest', error);
    }
}
