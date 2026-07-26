const mode = process.env.LAIR_TEST_RUNTIME_FAILURE;

if (mode === 'rejection') {
  setTimeout(() => {
    Promise.reject(new Error('runtime rejection fixture'));
  }, 500);
}

if (mode === 'exception') {
  setTimeout(() => {
    throw new Error('runtime exception fixture');
  }, 500);
}
