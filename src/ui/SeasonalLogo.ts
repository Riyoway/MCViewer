export function seasonalLogo(date = new Date()) {
  const month = date.getMonth();
  return month >= 2 && month <= 4 ? 'logo-spring.png' : month >= 5 && month <= 7 ? 'logo-summer.png' : 'logo.png';
}
