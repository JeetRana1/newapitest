const AwsIndStreamDomain 			= 'https://vekna402las.com/';

(function() {

	const AwsIndStreamIframeParamTr 	= IndStreamPlayerConfigs.tr !== false && IndStreamPlayerConfigs.tr > 0 ? '?tr=' + parseInt(IndStreamPlayerConfigs.tr) : '';
  	const AwsIndStreamPlayerIframe 		= document.createElement('iframe')
  	const AwsIndStreamIframeUrl 		= `${AwsIndStreamDomain}/play/${IndStreamPlayerConfigs.src}${AwsIndStreamIframeParamTr}`
  	var   initIndStreamPlayer 			= false;
  
	const genAwsPlayer = () => {
		AwsIndStreamPlayerIframe.setAttribute('src', AwsIndStreamIframeUrl)
		AwsIndStreamPlayerIframe.setAttribute('width', 1)
		AwsIndStreamPlayerIframe.setAttribute('height', 1)
		AwsIndStreamPlayerIframe.setAttribute('frameborder', 0)
		AwsIndStreamPlayerIframe.setAttribute('allowfullscreen', 'allowfullscreen')

	  	const AwsIndStreamPlayerContainer = typeof IndStreamPlayerConfigs.selector == 'string' 
	  		? document.querySelector (IndStreamPlayerConfigs.selector)
	  		: document.getElementById(IndStreamPlayerConfigs.id);
	  	
	  	if (AwsIndStreamPlayerContainer != null) {
			if (AwsIndStreamPlayerContainer.querySelector('iframe') == null) {
				AwsIndStreamPlayerContainer.appendChild(AwsIndStreamPlayerIframe)
			}
		} else {
			setTimeout(genAwsPlayer, 100)
		}
	}

	const AwsIndStreamAjax = (url, success, error) => {
	    var xhr = new XMLHttpRequest();
	    xhr.onreadystatechange = function() {
	        if (xhr.status != 200) {
	            if (typeof error == 'function') error()
	        } else {
	            if (xhr.readyState == XMLHttpRequest.DONE 
	            	&& typeof success == 'function') success()
	        }
	    }
	    xhr.open('GET', url, true);
	    xhr.send(null);
	}

	if ('btn' in IndStreamPlayerConfigs && document.querySelector(IndStreamPlayerConfigs.btn) != null) {
		AwsIndStreamAjax(AwsIndStreamIframeUrl, () => {
			document.querySelector(IndStreamPlayerConfigs.btn).style.display = 'block';
			if ('success' in IndStreamPlayerConfigs && typeof IndStreamPlayerConfigs.success == 'function') {
				IndStreamPlayerConfigs.success();
			}
		}, () => {
			document.querySelector(IndStreamPlayerConfigs.btn).style.display = 'none';
			if ('error' in IndStreamPlayerConfigs && typeof IndStreamPlayerConfigs.error == 'function') {
				IndStreamPlayerConfigs.error();
			}
		})

		document.querySelector(IndStreamPlayerConfigs.btn).addEventListener('click', genAwsPlayer);
	} else {
		document.addEventListener('DOMContentLoaded', genAwsPlayer);
	}

  	function listener(event) {
	  	if ('origin' in event) {
		  	if (event.origin == AwsIndStreamDomain && !initIndStreamPlayer) {
		  		if ('event' in event.data) {
			  		if (event.data.event == 'init') {
			  			AwsIndStreamPlayerIframe.width 	= IndStreamPlayerConfigs.width
			  			AwsIndStreamPlayerIframe.height = IndStreamPlayerConfigs.height
			  			initIndStreamPlayer = true;
			  		} else if (event.data.event == 'error') {
			  			AwsIndStreamPlayerContainer.remove()
			  		}
		  		}
		  	}
	  	}
	}

	if (window.addEventListener) {
	  	window.addEventListener("message", listener);
	} else {
	  	window.attachEvent("onmessage", listener);
	}
})();