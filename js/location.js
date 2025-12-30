/**
 * location.js - Sistema de ubicaciones Colombia
 * Permite seleccionar departamento y ciudad/municipio con búsqueda autocomplete
 *
 * OPTIMIZATION: Added debounce (150ms) to search input to reduce
 * unnecessary filtering operations during rapid typing.
 */

/**
 * Debounce utility - limits function execution rate
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait before executing
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

document.addEventListener("DOMContentLoaded", () => {
  const countrySelect = document.getElementById("pais");
  const departmentContainer = document.getElementById("provincia").parentElement;
  const cityContainer = document.getElementById("ciudad").parentElement;

  // Guardamos referencias a los selects originales para eliminarlos
  const originalDeptSelect = document.getElementById("provincia");
  const originalCitySelect = document.getElementById("ciudad");

  // País fijo: Colombia
  countrySelect.innerHTML = `<option value="Colombia" selected>Colombia</option>`;
  countrySelect.disabled = true;

  // Datos de ubicación
  let locationData = {};
  let departments = [];

  // Crear componente de autocompletado
  function createAutocomplete(id, placeholder, options, onChange) {
    const wrapper = document.createElement("div");
    wrapper.className = "autocomplete-wrapper";
    wrapper.innerHTML = `
      <input type="text"
             id="${id}"
             class="form-control autocomplete-input"
             placeholder="${placeholder}"
             autocomplete="off">
      <input type="hidden" id="${id}_value">
      <div class="autocomplete-dropdown" id="${id}_dropdown"></div>
    `;

    const input = wrapper.querySelector(".autocomplete-input");
    const hiddenInput = wrapper.querySelector(`#${id}_value`);
    const dropdown = wrapper.querySelector(".autocomplete-dropdown");

    let currentOptions = options;
    let selectedIndex = -1;

    function updateOptions(newOptions) {
      currentOptions = newOptions;
      input.value = "";
      hiddenInput.value = "";
    }

    function showDropdown(filteredOptions) {
      if (filteredOptions.length === 0) {
        dropdown.innerHTML = '<div class="autocomplete-no-results">No se encontraron resultados</div>';
        dropdown.classList.add("show");
        return;
      }

      dropdown.innerHTML = filteredOptions.slice(0, 50).map((opt, idx) => `
        <div class="autocomplete-item${idx === selectedIndex ? ' selected' : ''}" data-value="${opt}">${opt}</div>
      `).join("");
      dropdown.classList.add("show");

      // Click en opción
      dropdown.querySelectorAll(".autocomplete-item").forEach(item => {
        item.addEventListener("click", () => selectOption(item.dataset.value));
        item.addEventListener("touchend", (e) => {
          e.preventDefault();
          selectOption(item.dataset.value);
        });
      });
    }

    function selectOption(value) {
      input.value = value;
      hiddenInput.value = value;
      dropdown.classList.remove("show");
      selectedIndex = -1;
      if (onChange) onChange(value);
    }

    function filterOptions(query) {
      if (!query) return currentOptions;
      const normalizedQuery = normalizeText(query);
      return currentOptions.filter(opt =>
        normalizeText(opt).includes(normalizedQuery)
      );
    }

    // Normalizar texto para búsqueda (sin tildes, minúsculas)
    function normalizeText(text) {
      return text.normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase();
    }

    // Eventos - use debounced handler to avoid excessive filtering during rapid typing
    const debouncedFilter = debounce(() => {
      const filtered = filterOptions(input.value);
      selectedIndex = -1;
      showDropdown(filtered);
      // Si el valor exacto no existe, limpiar hidden
      if (!currentOptions.includes(input.value)) {
        hiddenInput.value = "";
      }
    }, 150); // 150ms debounce delay

    input.addEventListener("input", debouncedFilter);

    input.addEventListener("focus", () => {
      const filtered = filterOptions(input.value);
      showDropdown(filtered);
    });

    input.addEventListener("keydown", (e) => {
      const items = dropdown.querySelectorAll(".autocomplete-item");
      const filtered = filterOptions(input.value);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, Math.min(filtered.length - 1, 49));
        updateSelection(items);
        scrollToSelected(dropdown, items[selectedIndex]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection(items);
        scrollToSelected(dropdown, items[selectedIndex]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex >= 0 && items[selectedIndex]) {
          selectOption(items[selectedIndex].dataset.value);
        } else if (filtered.length === 1) {
          selectOption(filtered[0]);
        }
      } else if (e.key === "Escape") {
        dropdown.classList.remove("show");
      }
    });

    function updateSelection(items) {
      items.forEach((item, idx) => {
        item.classList.toggle("selected", idx === selectedIndex);
      });
    }

    function scrollToSelected(container, element) {
      if (element) {
        element.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }

    // Cerrar dropdown al hacer clic fuera
    document.addEventListener("click", (e) => {
      if (!wrapper.contains(e.target)) {
        dropdown.classList.remove("show");
      }
    });

    // Validación al salir del campo
    input.addEventListener("blur", () => {
      setTimeout(() => {
        // Si el valor no es válido, intentar match exacto o limpiar
        if (!currentOptions.includes(input.value)) {
          const exactMatch = currentOptions.find(opt =>
            normalizeText(opt) === normalizeText(input.value)
          );
          if (exactMatch) {
            selectOption(exactMatch);
          } else if (input.value && !dropdown.classList.contains("show")) {
            // Solo mantener el valor si está en la lista
            const filtered = filterOptions(input.value);
            if (filtered.length === 1) {
              selectOption(filtered[0]);
            }
          }
        }
      }, 200);
    });

    return {
      wrapper,
      input,
      hiddenInput,
      updateOptions,
      getValue: () => hiddenInput.value,
      setValue: (value) => {
        if (currentOptions.includes(value)) {
          input.value = value;
          hiddenInput.value = value;
        }
      },
      clear: () => {
        input.value = "";
        hiddenInput.value = "";
      }
    };
  }

  // Cargar datos de Colombia
  fetch("data/colombia.json")
    .then(response => response.json())
    .then(data => {
      locationData = data;
      departments = Object.keys(data).sort();

      // Reemplazar select de departamento con autocomplete
      const deptAutocomplete = createAutocomplete(
        "provincia",
        "Buscar departamento...",
        departments,
        (selectedDept) => {
          // Actualizar ciudades cuando cambie el departamento
          if (selectedDept && locationData[selectedDept]) {
            const cities = locationData[selectedDept].sort();
            cityAutocomplete.updateOptions(cities);
            cityAutocomplete.clear();
            cityAutocomplete.input.disabled = false;
            cityAutocomplete.input.placeholder = "Buscar ciudad/municipio...";
          } else {
            cityAutocomplete.updateOptions([]);
            cityAutocomplete.clear();
            cityAutocomplete.input.disabled = true;
            cityAutocomplete.input.placeholder = "Primero seleccione un departamento";
          }
        }
      );

      // Reemplazar select de ciudad con autocomplete
      const cityAutocomplete = createAutocomplete(
        "ciudad",
        "Primero seleccione un departamento",
        [],
        null
      );
      cityAutocomplete.input.disabled = true;

      // Reemplazar los selects originales
      originalDeptSelect.replaceWith(deptAutocomplete.wrapper);
      originalCitySelect.replaceWith(cityAutocomplete.wrapper);

      // Exponer funciones para validación
      window.locationAutocomplete = {
        getDepartment: () => deptAutocomplete.getValue(),
        getCity: () => cityAutocomplete.getValue(),
        validateCity: () => {
          const dept = deptAutocomplete.getValue();
          const city = cityAutocomplete.getValue();
          if (!dept || !city) return false;
          return locationData[dept] && locationData[dept].includes(city);
        },
        isValid: () => {
          return deptAutocomplete.getValue() && cityAutocomplete.getValue();
        }
      };
    })
    .catch(error => {
      console.error("Error cargando datos de ubicación:", error);
      // Fallback: mostrar mensaje de error
      departmentContainer.innerHTML = '<p class="text-danger">Error cargando departamentos</p>';
    });
});
