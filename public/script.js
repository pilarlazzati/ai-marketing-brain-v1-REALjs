function buildPromptFromForm() {
  const preset   = document.getElementById('preset')?.value || 'custom';
  const product  = document.getElementById('product')?.value?.trim()  || '';
  const headline = document.getElementById('headline')?.value?.trim() || '';
  const body     = document.getElementById('body')?.value?.trim()     || '';
  const cta      = document.getElementById('cta')?.value?.trim()      || '';
  const audience = document.getElementById('audience')?.value?.trim() || '';
  const proof    = document.getElementById('proof')?.value?.trim()    || '';
  const channels = Array.from(document.querySelectorAll('.ch:checked')).map(x => x.value);

  const brief = {
    campaign_type: preset,
    product, headline, body, cta, audience, proof,
    channels_requested: channels
  };
  return JSON.stringify(brief);
}