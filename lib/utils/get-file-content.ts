import * as https from 'https';

export const getFileContent = (url: string) => {
  return new Promise<any>((resolve, reject) => {
    https
      .get(url, (resp) => {
        let data = '';

        // Recebendo partes dos dados
        resp.on('data', (chunk) => {
          data += chunk;
        });

        // Quando todos os dados forem recebidos
        resp.on('end', () => {
          try {
            resolve(data);
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
