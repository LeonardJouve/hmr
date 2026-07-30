if (import.meta.hot) {
    import.meta.hot.setCallback((content) => {
        console.log(content);
    });
}

const element = document.getElementById("time");
element.textContent = new Date().toString();

