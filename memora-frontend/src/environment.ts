export const environment = {
    apiUrl: window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : 'https://api.austriants.at'
};