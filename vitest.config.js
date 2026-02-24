import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['modules/**/*.js', 'script.js'],
            exclude: [
                'node_modules/',
                'tests/',
                'lib-*.js',
                '*-module.js'
            ]
        },
        include: ['tests/**/*.test.js'],
        testTimeout: 10000
    }
});
