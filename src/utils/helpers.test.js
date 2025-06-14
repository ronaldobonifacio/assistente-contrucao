// ARQUIVO NOVO: src/utils/helpers.test.js

const { delay } = require('./helpers');

describe('helpers', () => {
    it('delay deve resolver após o tempo especificado', async () => {
        jest.useFakeTimers();
        const delayPromise = delay(1000);
        jest.runAllTimers();
        await expect(delayPromise).resolves.toBeUndefined();
        jest.useRealTimers();
    });
});