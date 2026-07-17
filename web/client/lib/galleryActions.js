export function isCurrentCuratedMediaRequest(request, current) {
  if (!request || !current) return false;
  return request.mediaGeneration === current.mediaGeneration &&
    (request.galleryGeneration === null ||
      request.galleryGeneration === current.galleryGeneration);
}
