import * as https from 'https';

export const getNpmPackage = (packageName: string) => {
  return new Promise<any>((resolve, reject) => {
    https
      .get(`https://registry.npmjs.org/${packageName}`, (resp) => {
        let data = '';

        // Recebendo partes dos dados
        resp.on('data', (chunk) => {
          data += chunk;
        });

        // Quando todos os dados forem recebidos
        resp.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', (err) => {
        reject(err);
      });
  });
};
