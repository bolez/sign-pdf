// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Application State
const state = {
    pdfDoc: null,
    pdfFile: null,
    signatureData: null,
    scale: 1.5,
    placedSignatures: [] // Array of {page, x, y, width, height, dataUrl}
};

// DOM Elements
const elements = {
    pdfInput: document.getElementById('pdfInput'),
    signatureInput: document.getElementById('signatureInput'),
    pdfUploadBtn: document.getElementById('pdfUploadBtn'),
    signatureUploadBtn: document.getElementById('signatureUploadBtn'),
    pdfFileInfo: document.getElementById('pdfFileInfo'),
    signatureFileInfo: document.getElementById('signatureFileInfo'),
    uploadSection: document.getElementById('uploadSection'),
    editorSection: document.getElementById('editorSection'),
    pagesContainer: document.getElementById('pagesContainer'),
    signaturePanel: document.getElementById('signaturePanel'),
    signaturePreview: document.getElementById('signaturePreview'),
    downloadBtn: document.getElementById('downloadBtn'),
    toolbarUploadSignBtn: document.getElementById('toolbarUploadSignBtn'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    toastContainer: document.getElementById('toastContainer')
};

// Event Listeners
elements.pdfUploadBtn.addEventListener('click', () => elements.pdfInput.click());
elements.signatureUploadBtn.addEventListener('click', () => elements.signatureInput.click());
elements.toolbarUploadSignBtn.addEventListener('click', () => elements.signatureInput.click());
elements.pdfInput.addEventListener('change', handlePdfUpload);
elements.signatureInput.addEventListener('change', handleSignatureUpload);
elements.downloadBtn.addEventListener('click', downloadSignedPdf);

// Toast Notification System
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Loading Overlay
function showLoading(show = true) {
    elements.loadingOverlay.style.display = show ? 'flex' : 'none';
}

// Handle PDF Upload
async function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        showToast('Please select a valid PDF file', 'error');
        return;
    }

    showLoading(true);
    state.pdfFile = file;

    try {
        const arrayBuffer = await file.arrayBuffer();
        state.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        // Update UI
        elements.pdfFileInfo.textContent = `✓ ${file.name} (${state.pdfDoc.numPages} pages)`;
        elements.pdfFileInfo.classList.add('active');

        // Show signature upload card
        document.getElementById('signatureUploadCard').style.display = 'block';
        elements.signatureUploadBtn.disabled = false;

        // Show editor section
        elements.uploadSection.style.display = 'none';
        elements.editorSection.style.display = 'grid';

        // Render ALL pages
        await renderAllPages();

        showToast('PDF loaded successfully!', 'success');
    } catch (error) {
        console.error('Error loading PDF:', error);
        showToast('Error loading PDF file', 'error');
    } finally {
        showLoading(false);
    }
}

// Render All PDF Pages
async function renderAllPages() {
    elements.pagesContainer.innerHTML = '';

    for (let i = 1; i <= state.pdfDoc.numPages; i++) {
        await renderSinglePage(i);
    }
}

async function renderSinglePage(pageNum) {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: state.scale });

    // Create Page Wrapper
    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-wrapper';
    pageWrapper.dataset.pageNum = pageNum;

    // Create Canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    pageWrapper.appendChild(canvas);
    elements.pagesContainer.appendChild(pageWrapper);

    // Render PDF to Canvas
    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;
}

// Handle Signature Upload
function handleSignatureUpload(event) {
    const file = event.target.files[0];
    if (!file || !file.type.startsWith('image/')) {
        showToast('Please select a valid image file', 'error');
        return;
    }

    showLoading(true);

    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            processSignatureImage(img, file.name);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Process Signature (Polished Background Removal)
function processSignatureImage(img, filename) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Polished approach: Non-linear fade to hide shadows
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Calculate brightness (0-255)
        const brightness = (r + g + b) / 3;

        // Remove light backgrounds, keep dark signature ink
        if (brightness > 170) {
            // Very light - fully transparent
            data[i + 3] = 0;
        } else if (brightness > 130) {
            // Gradient zone (130-170)
            const transparency = (brightness - 130) / 40; // 0 to 1

            // NON-LINEAR FADE: Fade out shadows much faster
            // Using cubic curve: (1-t)^3 pushes light grays to near-zero opacity
            const factor = Math.pow(1 - transparency, 3);

            data[i + 3] = Math.floor(factor * 255);
        }
        // brightness <= 130: Keep original (dark signature ink)
    }

    ctx.putImageData(imageData, 0, 0);
    state.signatureData = canvas.toDataURL('image/png');

    // Update UI
    elements.signaturePreview.src = state.signatureData;
    elements.signaturePanel.style.display = 'block';
    elements.signatureFileInfo.textContent = `✓ ${filename}`;
    elements.signatureFileInfo.classList.add('active');

    // Create draggable signature
    createDraggableSignature();

    showLoading(false);
    showToast('Signature ready! Drag it to the PDF', 'success');
}

// Create Draggable Signature
function createDraggableSignature() {
    // Remove any existing signature overlay
    const existing = document.querySelector('.signature-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'signature-overlay';

    overlay.style.position = 'fixed';
    overlay.style.left = '50%';
    overlay.style.top = '50%';
    overlay.style.transform = 'translate(-50%, -50%)';
    overlay.style.zIndex = '1000';
    overlay.style.cursor = 'move';

    const img = document.createElement('img');
    img.src = state.signatureData;
    img.style.width = '200px';
    img.style.height = 'auto';
    img.style.display = 'block';

    const btnContainer = document.createElement('div');
    btnContainer.className = 'signature-actions';
    btnContainer.style.position = 'absolute';
    btnContainer.style.top = '-40px';
    btnContainer.style.right = '0';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'action-btn apply-btn';
    applyBtn.textContent = '✓';
    applyBtn.title = 'Apply Signature';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Remove';

    btnContainer.appendChild(applyBtn);
    btnContainer.appendChild(deleteBtn);

    overlay.appendChild(btnContainer);
    overlay.appendChild(img);

    document.body.appendChild(overlay);

    // Make draggable
    let isDragging = false;
    let offsetX, offsetY;

    overlay.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        offsetX = e.clientX - overlay.getBoundingClientRect().left;
        offsetY = e.clientY - overlay.getBoundingClientRect().top;
        overlay.style.transform = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        overlay.style.left = (e.clientX - offsetX) + 'px';
        overlay.style.top = (e.clientY - offsetY) + 'px';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Apply button
    applyBtn.addEventListener('click', () => {
        const rect = overlay.getBoundingClientRect();
        const pages = document.querySelectorAll('.page-wrapper');

        for (const page of pages) {
            const pageRect = page.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            if (centerX >= pageRect.left && centerX <= pageRect.right &&
                centerY >= pageRect.top && centerY <= pageRect.bottom) {

                const pageNum = parseInt(page.dataset.pageNum);
                const canvas = page.querySelector('canvas');

                // Calculate position relative to page
                const x = Math.round(rect.left - pageRect.left);
                const y = Math.round(rect.top - pageRect.top);
                const width = Math.round(rect.width);
                const height = Math.round(rect.height);

                // Save signature data
                state.placedSignatures.push({
                    page: pageNum,
                    x: x / pageRect.width * canvas.width,
                    y: y / pageRect.height * canvas.height,
                    width: width / pageRect.width * canvas.width,
                    height: height / pageRect.height * canvas.height,
                    dataUrl: state.signatureData
                });

                // Place visual signature on page
                const placed = document.createElement('img');
                placed.src = state.signatureData;
                placed.className = 'placed-signature';
                placed.style.position = 'absolute';
                placed.style.left = x + 'px';
                placed.style.top = y + 'px';
                placed.style.width = width + 'px';
                placed.style.height = height + 'px';
                placed.style.pointerEvents = 'none';

                page.appendChild(placed);

                showToast('Signature applied!', 'success');
                createDraggableSignature(); // Create new for next signature
                return;
            }
        }

        showToast('Please position signature over a page', 'error');
    });

    // Delete button
    deleteBtn.addEventListener('click', () => {
        overlay.remove();
    });
}

// Download Signed PDF
async function downloadSignedPdf() {
    if (state.placedSignatures.length === 0) {
        showToast('Please add at least one signature first', 'error');
        return;
    }

    showLoading(true);

    try {
        const existingPdfBytes = await state.pdfFile.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
        const signatureImageBytes = await fetch(state.signatureData).then(res => res.arrayBuffer());
        const signatureImage = await pdfDoc.embedPng(signatureImageBytes);

        console.log('Total signatures to place:', state.placedSignatures.length);

        for (const sig of state.placedSignatures) {
            const page = pdfDoc.getPage(sig.page - 1);
            const rotation = page.getRotation().angle;
            const { width: pageWidth, height: pageHeight } = page.getSize();

            // Get the canvas for this page
            const pageWrapper = document.querySelector(`[data-page-num="${sig.page}"]`);
            const canvas = pageWrapper.querySelector('canvas');

            // Canvas dimensions (Visual dimensions)
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;

            // Scale factors (Visual to PDF Point)
            // Note: If rotated 90/270, pageWidth/Height are swapped relative to canvas
            let scaleX, scaleY;
            if (rotation === 90 || rotation === 270) {
                scaleX = pageHeight / canvasWidth;
                scaleY = pageWidth / canvasHeight;
            } else {
                scaleX = pageWidth / canvasWidth;
                scaleY = pageHeight / canvasHeight;
            }

            // Signature dimensions in PDF points (unrotated size)
            const sigWidth = sig.width * scaleX;
            const sigHeight = sig.height * scaleY;

            // Calculate position and rotation
            let x, y, rotateDegrees;

            if (rotation === 0) {
                x = sig.x * scaleX;
                y = pageHeight - (sig.y * scaleY) - sigHeight;
                rotateDegrees = 0;
            } else if (rotation === 90) {
                // Visual Top-Left (sig.x, sig.y) -> Unrotated Bottom-Left
                // Map: x' = y, y' = x
                // Pivot adjustment for 90deg rotation
                x = (sig.y * scaleY) + sigHeight;
                y = (sig.x * scaleX);
                rotateDegrees = 90;
            } else if (rotation === 180) {
                x = pageWidth - (sig.x * scaleX) - sigWidth;
                y = (sig.y * scaleY);
                rotateDegrees = 180;
            } else if (rotation === 270) {
                // Visual Top-Left -> Unrotated Top-Right
                // Map: x' = W - y, y' = H - x
                // Pivot adjustment for -90deg rotation
                x = pageWidth - (sig.y * scaleY) - sigHeight;
                y = pageHeight - (sig.x * scaleX);
                rotateDegrees = 270; // or -90
            }

            console.log(`Page ${sig.page} (Rot: ${rotation}°):`, {
                canvas: { w: canvasWidth, h: canvasHeight },
                pdf: { w: pageWidth, h: pageHeight },
                sig: { x: sig.x, y: sig.y, w: sig.width, h: sig.height },
                final: { x, y, w: sigWidth, h: sigHeight, rot: rotateDegrees }
            });

            page.drawImage(signatureImage, {
                x: x,
                y: y,
                width: sigWidth,
                height: sigHeight,
                rotate: PDFLib.degrees(rotateDegrees)
            });
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'signed_' + state.pdfFile.name;
        link.click();
        URL.revokeObjectURL(url);

        showLoading(false);
        showToast('PDF downloaded successfully!', 'success');

    } catch (error) {
        console.error('Error:', error);
        showLoading(false);
        showToast('Error: ' + error.message, 'error');
    }
}

console.log('PDF Signature App initialized!');
